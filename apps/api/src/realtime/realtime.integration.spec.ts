import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { readAppConfig } from '../config/app-config.js';
import { DatabaseService } from '../database/database.service.js';
import { createApplication } from '../main.js';
import { RealtimeGateway } from './realtime.gateway.js';

describe('Realtime WebSocket seam', () => {
  let app: Awaited<ReturnType<typeof createApplication>>;
  let server: FastifyInstance;
  let websocketUrl: string;

  beforeAll(async () => {
    app = await createApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
    server = app.getHttpAdapter().getInstance();
    websocketUrl = (await app.getUrl()).replace(/^http/, 'ws') + '/ws';
  });

  afterAll(async () => {
    await app.close();
  });

  it('authenticates, sends a reconnect snapshot, and relays a Trip outbox event', async () => {
    const database = app.get(DatabaseService);
    await database.query(
      `UPDATE dispatch.driver_work_states
       SET work_state = 'OFFLINE', current_trip_id = NULL,
           state_version = state_version + 1, state_changed_at = now(), updated_at = now()
       WHERE work_state = 'AVAILABLE'`,
    );
    const email = `realtime.${randomUUID()}@gove.test`;
    const password = 'correct horse battery staple';
    const registration = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'idempotency-key': randomUUID() },
      payload: {
        email,
        displayName: 'Realtime Customer',
        password,
        requestedRole: 'CUSTOMER',
      },
    });
    expect(registration.statusCode).toBe(201);

    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().accessToken as string;

    const quote = await server.inject({
      method: 'POST',
      url: '/api/v1/pricing/fare-quotes',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: {
        pickup: {
          label: 'Realtime pickup',
          latitude: 21.0285,
          longitude: 105.8048,
        },
        dropoff: {
          label: 'Realtime dropoff',
          latitude: 21.033,
          longitude: 105.835,
        },
        serviceType: 'MOTORBIKE_STANDARD',
      },
    });
    expect(quote.statusCode).toBe(201);

    const trip = await server.inject({
      method: 'POST',
      url: '/api/v1/trips',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: { fareQuoteId: quote.json().id },
    });
    expect(trip.statusCode).toBe(201);
    const tripId = trip.json().id as string;

    const socket = await connect(websocketUrl);
    try {
      const authenticatedPromise = nextMessage(
        socket,
        (message) => message.type === 'authenticated',
        'authenticated',
      );
      socket.send(JSON.stringify({ type: 'authenticate', accessToken }));
      expect((await authenticatedPromise).type).toBe('authenticated');

      const snapshotPromise = nextMessage(
        socket,
        (message) => message.type === 'trip.snapshot',
        'snapshot',
      );
      socket.send(JSON.stringify({ type: 'subscribe', tripIds: [tripId] }));
      const snapshot = await snapshotPromise;
      expect(snapshot.snapshot.id).toBe(tripId);
      expect(snapshot.snapshot.state).toBe('REQUESTED');
      expect(snapshot.snapshot.version).toBe(0);

      const pongPromise = nextMessage(
        socket,
        (message) => message.type === 'pong',
        'pong',
      );
      socket.send(JSON.stringify({ type: 'ping' }));
      expect((await pongPromise).type).toBe('pong');

      const eventPromise = nextMessage(
        socket,
        (message) =>
          message.type === 'trip.event' &&
          message.tripId === tripId &&
          message.eventType === 'trip.matching.started',
        'matching event',
      );
      const match = await server.inject({
        method: 'POST',
        url: `/api/v1/dispatch/trips/${tripId}/match`,
        headers: {
          authorization: `Bearer ${accessToken}`,
          'idempotency-key': randomUUID(),
        },
      });
      expect(match.statusCode).toBe(201);
      expect(match.json().tripState).toBe('NO_DRIVER_AVAILABLE');

      const event = await eventPromise;
      expect(event.aggregateVersion).toBe(1);
    } finally {
      socket.close();
    }
  });

  it('emits same-Trip outbox events by aggregate version when UUID order differs', async () => {
    const database = app.get(DatabaseService);
    const customer = await registerAndLogin(
      server,
      'CUSTOMER',
      'Realtime outbox ordering Customer',
    );
    const tripId = await createTrip(server, customer.accessToken);
    const socket = await connect(websocketUrl);

    try {
      await authenticateSocket(socket, customer.accessToken);
      const snapshot = nextMessage(
        socket,
        (message) =>
          message.type === 'trip.snapshot' && message.snapshot.id === tripId,
        'outbox ordering snapshot',
      );
      socket.send(JSON.stringify({ type: 'subscribe', tripIds: [tripId] }));
      await snapshot;

      const earlierEvent = nextMessage(
        socket,
        (message) =>
          message.type === 'trip.event' &&
          message.tripId === tripId &&
          message.eventType === 'trip.audit.earlier',
        'earlier aggregate event',
      );
      const laterEvent = nextMessage(
        socket,
        (message) =>
          message.type === 'trip.event' &&
          message.tripId === tripId &&
          message.eventType === 'trip.audit.later',
        'later aggregate event',
      );

      await database.query(
        `INSERT INTO trip.outbox_events (
           id, trip_id, aggregate_version, event_type, payload, occurred_at
         ) VALUES
           ($2, $1, 3,
            'trip.audit.later', '{}'::jsonb, now()),
           ($3, $1, 2,
            'trip.audit.earlier', '{}'::jsonb, now())`,
        [tripId, randomUUID(), randomUUID()],
      );

      const [first, second] = await Promise.all([earlierEvent, laterEvent]);
      expect(first.aggregateVersion).toBe(2);
      expect(second.aggregateVersion).toBe(3);
    } finally {
      socket.close();
    }
  });

  it('enforces the configured browser Origin while preserving native clients', async () => {
    const allowed = await connect(websocketUrl, readAppConfig().WEB_ORIGIN);
    allowed.close();

    const native = await connect(websocketUrl);
    native.close();

    await expect(
      connect(websocketUrl, 'https://untrusted.example'),
    ).rejects.toThrow('403');
  });

  it('adds authorized aggregate subscriptions without dropping existing subscriptions', async () => {
    const database = app.get(DatabaseService);
    await database.query(
      `UPDATE dispatch.driver_work_states
       SET work_state = 'OFFLINE', current_trip_id = NULL,
           current_delivery_id = NULL, state_version = state_version + 1,
           state_changed_at = now(), updated_at = now()
       WHERE work_state = 'AVAILABLE'`,
    );
    const customer = await registerAndLogin(
      server,
      'CUSTOMER',
      'Realtime additive subscriptions Customer',
    );
    const firstTripId = await createTrip(server, customer.accessToken);
    const delivery = await server.inject({
      method: 'POST',
      url: '/api/v1/deliveries',
      headers: {
        authorization: `Bearer ${customer.accessToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: {
        pickup: {
          label: 'Additive delivery pickup',
          latitude: 21.0285,
          longitude: 105.8048,
        },
        dropoff: {
          label: 'Additive delivery dropoff',
          latitude: 21.033,
          longitude: 105.835,
        },
        recipient: {
          displayName: 'Additive recipient',
          contactPhone: '+84901234567',
        },
        parcel: {
          description: 'Additive parcel',
          declaredWeightGrams: 500,
        },
      },
    });
    expect(delivery.statusCode).toBe(201);
    const deliveryId = delivery.json().id as string;
    const socket = await connect(websocketUrl);
    try {
      await authenticateSocket(socket, customer.accessToken);

      const firstSnapshot = nextMessage(
        socket,
        (message) =>
          message.type === 'trip.snapshot' &&
          message.snapshot.id === firstTripId,
        'first additive Trip snapshot',
      );
      const deliverySnapshot = nextMessage(
        socket,
        (message) =>
          message.type === 'delivery.snapshot' &&
          message.snapshot.id === deliveryId,
        'additive Delivery snapshot',
      );
      socket.send(
        JSON.stringify({
          type: 'subscribe',
          tripIds: [firstTripId],
          deliveryIds: [deliveryId],
        }),
      );
      await Promise.all([firstSnapshot, deliverySnapshot]);

      const firstNoDriver = nextMessage(
        socket,
        (message) =>
          message.type === 'trip.event' &&
          message.tripId === firstTripId &&
          message.eventType === 'trip.no_driver_available',
        'first Trip no Driver event',
      );
      const firstMatching = await server.inject({
        method: 'POST',
        url: `/api/v1/dispatch/trips/${firstTripId}/match`,
        headers: {
          authorization: `Bearer ${customer.accessToken}`,
          'idempotency-key': randomUUID(),
        },
      });
      expect(firstMatching.statusCode).toBe(201);
      expect(firstMatching.json().tripState).toBe('NO_DRIVER_AVAILABLE');
      await firstNoDriver;

      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (app.get(RealtimeGateway).getMetrics().subscriptions === 1) break;
        await delay(25);
      }
      expect(app.get(RealtimeGateway).getMetrics().subscriptions).toBe(1);

      const deliveryResubscribeSnapshot = nextMessage(
        socket,
        (message) =>
          message.type === 'delivery.snapshot' &&
          message.snapshot.id === deliveryId,
        'preserved Delivery snapshot',
      );
      socket.send(
        JSON.stringify({ type: 'subscribe', deliveryIds: [deliveryId] }),
      );
      await deliveryResubscribeSnapshot;
    } finally {
      socket.close();
    }
  });

  it('sends an authorized Customer Delivery snapshot and committed Delivery event', async () => {
    const database = app.get(DatabaseService);
    await database.query(
      `UPDATE dispatch.driver_work_states
       SET work_state = 'OFFLINE', current_trip_id = NULL,
           current_delivery_id = NULL, state_version = state_version + 1,
           state_changed_at = now(), updated_at = now()
       WHERE work_state = 'AVAILABLE'`,
    );
    const customer = await registerAndLogin(
      server,
      'CUSTOMER',
      'Realtime Delivery Customer',
    );
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/deliveries',
      headers: {
        authorization: `Bearer ${customer.accessToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: {
        pickup: {
          label: 'Realtime parcel pickup',
          latitude: 21.0285,
          longitude: 105.8048,
        },
        dropoff: {
          label: 'Realtime parcel dropoff',
          latitude: 21.033,
          longitude: 105.835,
        },
        recipient: {
          displayName: 'Realtime Recipient',
          contactPhone: '+84901234567',
        },
        parcel: {
          description: 'Realtime test parcel',
          declaredWeightGrams: 500,
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const deliveryId = created.json().id as string;

    const socket = await connect(websocketUrl);
    try {
      await authenticateSocket(socket, customer.accessToken);
      const snapshotPromise = nextMessage(
        socket,
        (message) => message.type === 'delivery.snapshot',
        'Delivery snapshot',
      );
      socket.send(
        JSON.stringify({ type: 'subscribe', deliveryIds: [deliveryId] }),
      );
      const snapshot = await snapshotPromise;
      expect(snapshot.snapshot).toMatchObject({
        id: deliveryId,
        state: 'REQUESTED',
        version: 0,
        driverId: null,
      });

      const matchingPromise = nextMessage(
        socket,
        (message) =>
          message.type === 'delivery.event' &&
          message.deliveryId === deliveryId &&
          message.eventType === 'delivery.matching.started',
        'Delivery matching event',
      );
      const noDriverPromise = nextMessage(
        socket,
        (message) =>
          message.type === 'delivery.event' &&
          message.deliveryId === deliveryId &&
          message.eventType === 'delivery.no_driver_available',
        'Delivery no Driver event',
      );
      const matching = await server.inject({
        method: 'POST',
        url: `/api/v1/deliveries/${deliveryId}/match`,
        headers: {
          authorization: `Bearer ${customer.accessToken}`,
          'idempotency-key': randomUUID(),
        },
      });
      expect(matching.statusCode).toBe(201);
      expect((await matchingPromise).aggregateVersion).toBe(1);
      await noDriverPromise;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (app.get(RealtimeGateway).getMetrics().subscriptions === 0) break;
        await delay(25);
      }
      expect(app.get(RealtimeGateway).getMetrics().subscriptions).toBe(0);
    } finally {
      socket.close();
    }
  });

  it('relays an assigned Driver location to an authorized Delivery subscriber', async () => {
    const database = app.get(DatabaseService);
    const customer = await registerAndLogin(
      server,
      'CUSTOMER',
      'Realtime Delivery Location Customer',
    );
    const driver = await registerAndLogin(
      server,
      'DRIVER',
      'Realtime Delivery Location Driver',
    );
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/deliveries',
      headers: {
        authorization: `Bearer ${customer.accessToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: {
        pickup: {
          label: 'Realtime delivery tracking pickup',
          latitude: 21.0285,
          longitude: 105.8048,
        },
        dropoff: {
          label: 'Realtime delivery tracking dropoff',
          latitude: 21.033,
          longitude: 105.835,
        },
        recipient: {
          displayName: 'Realtime tracking recipient',
          contactPhone: '+84901234567',
        },
        parcel: {
          description: 'Realtime tracking parcel',
          declaredWeightGrams: 500,
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const deliveryId = created.json().id as string;
    const reservationId = randomUUID();
    const offerId = randomUUID();
    await database.query(
      `INSERT INTO delivery.driver_reservations (
         id, driver_user_id, delivery_id, status, expires_at,
         resolved_at, resolution_reason, resolved_by_user_id
       ) VALUES ($1, $2, $3, 'COMMITTED', now() + INTERVAL '1 minute',
                 now(), 'OFFER_ACCEPTED', $2)`,
      [reservationId, driver.actorId, deliveryId],
    );
    await database.query(
      `INSERT INTO delivery.delivery_offers (
         id, delivery_id, reservation_id, driver_user_id, attempt_number,
         status, expires_at, resolved_at, resolution_reason,
         accepted_by_user_id, acceptance_idempotency_key,
         accepted_delivery_version
       ) VALUES ($1, $2, $3, $4, 1, 'ACCEPTED', now() + INTERVAL '1 minute',
                 now(), 'OFFER_ACCEPTED', $4, 'realtime-delivery-location', 1)`,
      [offerId, deliveryId, reservationId, driver.actorId],
    );
    await database.query(
      `INSERT INTO delivery.assignments (id, delivery_id, offer_id, driver_user_id)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), deliveryId, offerId, driver.actorId],
    );
    await database.query(
      `UPDATE delivery.deliveries
       SET state = 'DRIVER_TO_PICKUP', version = 1, updated_at = now()
       WHERE id = $1 AND state = 'REQUESTED'`,
      [deliveryId],
    );
    const workState = await database.query(
      `INSERT INTO dispatch.driver_work_states (
         driver_user_id, work_state, current_trip_id, current_delivery_id
       ) VALUES ($1, 'TO_PICKUP', NULL, $2)
       ON CONFLICT (driver_user_id) DO UPDATE
       SET work_state = 'TO_PICKUP', current_trip_id = NULL,
           current_delivery_id = EXCLUDED.current_delivery_id,
           state_version = dispatch.driver_work_states.state_version + 1,
           state_changed_at = now(), updated_at = now()
       RETURNING driver_user_id`,
      [driver.actorId, deliveryId],
    );
    expect(workState.rowCount).toBe(1);

    const customerSocket = await connect(websocketUrl);
    const driverSocket = await connect(websocketUrl);
    try {
      await authenticateSocket(customerSocket, customer.accessToken);
      await authenticateSocket(driverSocket, driver.accessToken);
      const snapshot = nextMessage(
        customerSocket,
        (message) =>
          message.type === 'delivery.snapshot' &&
          message.snapshot.id === deliveryId,
        'Delivery tracking snapshot',
      );
      customerSocket.send(
        JSON.stringify({ type: 'subscribe', deliveryIds: [deliveryId] }),
      );
      await snapshot;

      const deliveryLocation = nextMessage(
        customerSocket,
        (message) =>
          message.type === 'delivery.driver.location' &&
          message.deliveryId === deliveryId,
        'Delivery Driver location',
      );
      driverSocket.send(
        JSON.stringify({ type: 'location', location: realtimeLocation(1) }),
      );
      expect((await deliveryLocation).driverId).toBe(driver.actorId);

      const reconnectSnapshotPromise = nextMessage(
        customerSocket,
        (message) =>
          message.type === 'delivery.snapshot' &&
          message.snapshot.id === deliveryId &&
          message.snapshot.driverLocation !== null,
        'Delivery snapshot with Driver location',
      );
      customerSocket.send(
        JSON.stringify({ type: 'subscribe', deliveryIds: [deliveryId] }),
      );
      const reconnectSnapshot = await reconnectSnapshotPromise;
      expect(reconnectSnapshot.snapshot.driverLocation).toMatchObject({
        latitude: 21.02851,
        longitude: 105.80481,
        accuracyMeters: 5,
      });
    } finally {
      customerSocket.close();
      driverSocket.close();
    }
  });

  it('revokes a pending Driver subscription when the Customer cancels the Trip', async () => {
    const database = app.get(DatabaseService);
    await database.query(
      `UPDATE dispatch.driver_work_states
       SET work_state = 'OFFLINE', current_trip_id = NULL,
           state_version = state_version + 1, state_changed_at = now(), updated_at = now()
       WHERE work_state = 'AVAILABLE'`,
    );
    const customer = await registerAndLogin(
      server,
      'CUSTOMER',
      'Realtime cancellation Customer',
    );
    const driver = await registerAndLogin(
      server,
      'DRIVER',
      'Realtime cancellation Driver',
    );
    await database.query(
      `UPDATE driver.driver_profiles
       SET approval_status = 'APPROVED', reviewed_at = now()
       WHERE user_id = $1`,
      [driver.actorId],
    );
    await database.query(
      `INSERT INTO driver.vehicles (
         id, driver_user_id, vehicle_class, make, model, model_year,
         plate_normalized, approval_status, is_selected
       ) VALUES ($1, $2, 'MOTORBIKE', 'Demo', 'Realtime', 2024, $3, 'APPROVED', true)`,
      [
        randomUUID(),
        driver.actorId,
        `RC${randomUUID().replaceAll('-', '').slice(0, 14).toUpperCase()}`,
      ],
    );
    const location = await server.inject({
      method: 'PUT',
      url: '/api/v1/drivers/me/location',
      headers: { authorization: `Bearer ${driver.accessToken}` },
      payload: {
        latitude: 21.0285,
        longitude: 105.8048,
        accuracyMeters: 5,
        source: 'SIMULATOR',
        sequenceNumber: 1,
      },
    });
    expect(location.statusCode).toBe(200);
    const available = await server.inject({
      method: 'PUT',
      url: '/api/v1/drivers/me/work-state',
      headers: { authorization: `Bearer ${driver.accessToken}` },
      payload: { state: 'AVAILABLE' },
    });
    expect(available.statusCode).toBe(200);

    const tripId = await createTrip(server, customer.accessToken);
    const customerSocket = await connect(websocketUrl);
    const driverSocket = await connect(websocketUrl);
    try {
      await authenticateSocket(customerSocket, customer.accessToken);
      await authenticateSocket(driverSocket, driver.accessToken);

      const customerSnapshot = nextMessage(
        customerSocket,
        (message) =>
          message.type === 'trip.snapshot' && message.snapshot.id === tripId,
        'Customer cancellation snapshot',
      );
      customerSocket.send(
        JSON.stringify({ type: 'subscribe', tripIds: [tripId] }),
      );
      await customerSnapshot;

      const matching = await server.inject({
        method: 'POST',
        url: `/api/v1/dispatch/trips/${tripId}/match`,
        headers: {
          authorization: `Bearer ${customer.accessToken}`,
          'idempotency-key': randomUUID(),
        },
      });
      expect(matching.statusCode).toBe(201);
      expect(matching.json().offer.driverId).toBe(driver.actorId);

      const driverSnapshot = nextMessage(
        driverSocket,
        (message) =>
          message.type === 'trip.snapshot' && message.snapshot.id === tripId,
        'Driver cancellation snapshot',
      );
      driverSocket.send(
        JSON.stringify({ type: 'subscribe', tripIds: [tripId] }),
      );
      await driverSnapshot;

      const cancelled = nextMessage(
        driverSocket,
        (message) =>
          message.type === 'trip.event' &&
          message.tripId === tripId &&
          message.eventType === 'trip.cancelled',
        'Trip cancellation event',
      );
      const cancellation = await server.inject({
        method: 'POST',
        url: `/api/v1/trips/${tripId}/cancel`,
        headers: {
          authorization: `Bearer ${customer.accessToken}`,
          'idempotency-key': randomUUID(),
        },
        payload: { reasonCode: 'CHANGE_OF_PLANS' },
      });
      expect(cancellation.statusCode).toBe(201);
      expect((await cancelled).payload).toMatchObject({
        cancelledByRole: 'CUSTOMER',
        driverUserIds: [driver.actorId],
      });

      const gateway = app.get(RealtimeGateway);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (gateway.getMetrics().subscriptions === 1) break;
        await delay(25);
      }
      expect(gateway.getMetrics().subscriptions).toBe(0);

      const unexpectedFollowUp = expectNoMatchingMessage(
        customerSocket,
        (message) =>
          message.type === 'trip.event' &&
          message.tripId === tripId &&
          message.eventType === 'trip.audit.follow_up',
        600,
      );
      await database.query(
        `INSERT INTO trip.outbox_events (
           id, trip_id, aggregate_version, event_type, payload
         ) VALUES ($1, $2, 999, 'trip.audit.follow_up', '{}'::jsonb)`,
        [randomUUID(), tripId],
      );
      await unexpectedFollowUp;
    } finally {
      customerSocket.close();
      driverSocket.close();
    }
  });

  it('authorizes Driver location updates and broadcasts them to the Trip customer', async () => {
    const database = app.get(DatabaseService);
    await database.query(
      `UPDATE dispatch.driver_work_states
       SET work_state = 'OFFLINE', current_trip_id = NULL,
           state_version = state_version + 1, state_changed_at = now(), updated_at = now()
       WHERE work_state = 'AVAILABLE'`,
    );
    const customer = await registerAndLogin(
      server,
      'CUSTOMER',
      'Realtime Rider',
    );
    const driver = await registerAndLogin(server, 'DRIVER', 'Realtime Driver');
    await database.query(
      `UPDATE driver.driver_profiles
       SET approval_status = 'APPROVED', reviewed_at = now()
       WHERE user_id = $1`,
      [driver.actorId],
    );
    await database.query(
      `INSERT INTO driver.vehicles (
         id, driver_user_id, vehicle_class, make, model, model_year,
         plate_normalized, approval_status, is_selected
       ) VALUES ($1, $2, 'MOTORBIKE', 'Demo', 'Realtime', 2024, $3, 'APPROVED', true)`,
      [
        randomUUID(),
        driver.actorId,
        `RT${randomUUID().replaceAll('-', '').slice(0, 14).toUpperCase()}`,
      ],
    );
    const location = await server.inject({
      method: 'PUT',
      url: '/api/v1/drivers/me/location',
      headers: { authorization: `Bearer ${driver.accessToken}` },
      payload: {
        latitude: 21.0285,
        longitude: 105.8048,
        accuracyMeters: 5,
        source: 'SIMULATOR',
        sequenceNumber: 1,
      },
    });
    expect(location.statusCode).toBe(200);
    const available = await server.inject({
      method: 'PUT',
      url: '/api/v1/drivers/me/work-state',
      headers: { authorization: `Bearer ${driver.accessToken}` },
      payload: { state: 'AVAILABLE' },
    });
    expect(available.statusCode).toBe(200);

    const tripId = await createTrip(server, customer.accessToken);
    let customerSocket = await connect(websocketUrl);
    const driverSocket = await connect(websocketUrl);
    try {
      await authenticateSocket(customerSocket, customer.accessToken);
      await authenticateSocket(driverSocket, driver.accessToken);
      const snapshotPromise = nextMessage(
        customerSocket,
        (message) => message.type === 'trip.snapshot',
        'driver-flow snapshot',
      );
      customerSocket.send(
        JSON.stringify({ type: 'subscribe', tripIds: [tripId] }),
      );
      expect((await snapshotPromise).snapshot.id).toBe(tripId);

      const matching = await server.inject({
        method: 'POST',
        url: `/api/v1/dispatch/trips/${tripId}/match`,
        headers: {
          authorization: `Bearer ${customer.accessToken}`,
          'idempotency-key': randomUUID(),
        },
      });
      expect(matching.statusCode).toBe(201);
      expect(matching.json().offer.driverId).toBe(driver.actorId);
      const offerId = matching.json().offer.id as string;

      const assignedPromise = nextMessage(
        customerSocket,
        (message) =>
          message.type === 'trip.event' &&
          message.eventType === 'trip.driver.assigned',
        'driver assigned event',
      );
      const accepted = await server.inject({
        method: 'POST',
        url: `/api/v1/dispatch/offers/${offerId}/accept`,
        headers: {
          authorization: `Bearer ${driver.accessToken}`,
          'idempotency-key': randomUUID(),
        },
      });
      expect(accepted.statusCode).toBe(201);
      expect((await assignedPromise).aggregateVersion).toBe(2);

      await delay(3_050);
      const acceptedLocationPromise = nextMessage(
        driverSocket,
        (message) => message.type === 'location.accepted',
        'location accepted event',
      );
      const customerLocationPromise = nextMessage(
        customerSocket,
        (message) =>
          message.type === 'driver.location' && message.tripId === tripId,
        'driver location event',
      );
      driverSocket.send(
        JSON.stringify({
          type: 'location',
          location: {
            latitude: 21.0295,
            longitude: 105.8058,
            accuracyMeters: 4,
            source: 'SIMULATOR',
            sequenceNumber: 2,
          },
        }),
      );
      expect((await acceptedLocationPromise).sequenceNumber).toBe('2');
      expect((await customerLocationPromise).driverId).toBe(driver.actorId);

      const disconnected = new Promise<void>((resolve) => {
        customerSocket.once('close', () => resolve());
      });
      customerSocket.close();
      await disconnected;

      customerSocket = await connect(websocketUrl);
      await authenticateSocket(customerSocket, customer.accessToken);
      const reconnectSnapshotPromise = nextMessage(
        customerSocket,
        (message) =>
          message.type === 'trip.snapshot' &&
          message.snapshot.id === tripId &&
          message.snapshot.driverLocation !== null,
        'Trip snapshot with Driver location',
      );
      customerSocket.send(
        JSON.stringify({ type: 'subscribe', tripIds: [tripId] }),
      );
      const reconnectSnapshot = await reconnectSnapshotPromise;
      expect(reconnectSnapshot.snapshot.driverLocation).toMatchObject({
        latitude: 21.0295,
        longitude: 105.8058,
        accuracyMeters: 4,
      });
      expect(
        typeof reconnectSnapshot.snapshot.driverLocation?.accuracyMeters,
      ).toBe('number');

      const arrived = await server.inject({
        method: 'POST',
        url: `/api/v1/dispatch/trips/${tripId}/arrive`,
        headers: {
          authorization: `Bearer ${driver.accessToken}`,
          'idempotency-key': randomUUID(),
        },
      });
      expect(arrived.statusCode).toBe(201);
      const started = await server.inject({
        method: 'POST',
        url: `/api/v1/dispatch/trips/${tripId}/start`,
        headers: {
          authorization: `Bearer ${driver.accessToken}`,
          'idempotency-key': randomUUID(),
        },
      });
      expect(started.statusCode).toBe(201);
      const completedEvent = nextMessage(
        customerSocket,
        (message) =>
          message.type === 'trip.event' &&
          message.tripId === tripId &&
          message.eventType === 'trip.completed',
        'Trip completed event',
      );
      const completed = await server.inject({
        method: 'POST',
        url: `/api/v1/dispatch/trips/${tripId}/complete`,
        headers: {
          authorization: `Bearer ${driver.accessToken}`,
          'idempotency-key': randomUUID(),
        },
        payload: { actualDistanceMeters: 1_200, actualDurationSeconds: 360 },
      });
      expect(completed.statusCode).toBe(201);
      await completedEvent;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (app.get(RealtimeGateway).getMetrics().subscriptions === 0) break;
        await delay(25);
      }
      expect(app.get(RealtimeGateway).getMetrics().subscriptions).toBe(0);
      const terminalSnapshotPromise = nextMessage(
        customerSocket,
        (message) =>
          message.type === 'trip.snapshot' && message.snapshot.id === tripId,
        'Terminal Trip snapshot without Driver location',
      );
      customerSocket.send(
        JSON.stringify({ type: 'subscribe', tripIds: [tripId] }),
      );
      expect(await terminalSnapshotPromise).toMatchObject({
        snapshot: { driverId: null, driverLocation: null },
      });
      customerSocket.send(JSON.stringify({ type: 'subscribe', tripIds: [] }));
    } finally {
      customerSocket.close();
      driverSocket.close();
    }
  });

  it('limits messages per WebSocket connection with a clear server error', async () => {
    const customer = await registerAndLogin(
      server,
      'CUSTOMER',
      'Realtime message quota customer',
    );
    const socket = await connect(websocketUrl);
    try {
      await authenticateSocket(socket, customer.accessToken);
      const limited = nextServerMessage(
        socket,
        (message) =>
          message.type === 'error' && message.code === 'MESSAGE_RATE_LIMITED',
        'message quota error',
      );
      for (let index = 0; index < 60; index += 1) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
      const error = await limited;
      expect(error.message).toContain('Too many realtime messages');
    } finally {
      socket.close();
    }
  });

  it('revalidates the session on heartbeat and closes revoked sockets explicitly', async () => {
    const customer = await registerAndLogin(
      server,
      'CUSTOMER',
      'Realtime revalidation customer',
    );
    expect(customer.refreshCookie).toContain('gove_refresh=');
    const socket = await connect(websocketUrl);
    try {
      await authenticateSocket(socket, customer.accessToken);

      const logout = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          cookie: customer.refreshCookie,
          origin: readAppConfig().WEB_ORIGIN,
        },
      });
      expect(logout.statusCode).toBe(204);

      const reauthRequired = nextServerMessage(
        socket,
        (message) =>
          message.type === 'error' && message.code === 'AUTH_REAUTH_REQUIRED',
        're-authentication required error',
      );
      const closed = nextClose(socket, 're-authentication close');
      const gateway = app.get(RealtimeGateway) as unknown as {
        runHeartbeat(): void;
      };
      gateway.runHeartbeat();

      expect((await reauthRequired).message).toContain(
        'expired or was revoked',
      );
      const close = await closed;
      expect(close.code).toBe(1008);
      expect(close.reason).toBe('AUTH_REAUTH_REQUIRED');
    } finally {
      if (socket.readyState === WebSocket.OPEN) socket.close();
    }
  });

  it('limits location updates across authenticated sockets for the same Driver while allowing a 3-second cadence', async () => {
    const driver = await registerAndLogin(
      server,
      'DRIVER',
      'Realtime location quota driver',
    );
    const firstSocket = await connect(websocketUrl);
    const secondSocket = await connect(websocketUrl);
    try {
      await authenticateSocket(firstSocket, driver.accessToken);
      await authenticateSocket(secondSocket, driver.accessToken);

      const firstAccepted = nextMessage(
        firstSocket,
        (message) => message.type === 'location.accepted',
        'first location accepted',
      );
      firstSocket.send(
        JSON.stringify({
          type: 'location',
          location: realtimeLocation(1),
        }),
      );
      expect((await firstAccepted).sequenceNumber).toBe('1');

      const limited = nextServerMessage(
        secondSocket,
        (message) =>
          message.type === 'error' && message.code === 'LOCATION_RATE_LIMITED',
        'location quota error',
      );
      secondSocket.send(
        JSON.stringify({
          type: 'location',
          location: realtimeLocation(2),
        }),
      );
      expect((await limited).message).toContain('every 3 seconds');

      await delay(3_050);
      const nextAccepted = nextMessage(
        secondSocket,
        (message) => message.type === 'location.accepted',
        'location accepted after quota window',
      );
      secondSocket.send(
        JSON.stringify({
          type: 'location',
          location: realtimeLocation(3),
        }),
      );
      expect((await nextAccepted).sequenceNumber).toBe('3');
    } finally {
      firstSocket.close();
      secondSocket.close();
    }
  });
});

async function registerAndLogin(
  server: FastifyInstance,
  role: 'CUSTOMER' | 'DRIVER',
  displayName: string,
): Promise<{ accessToken: string; actorId: string; refreshCookie: string }> {
  const email = `${role.toLowerCase()}.${randomUUID()}@gove.test`;
  const registration = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { 'idempotency-key': randomUUID() },
    payload: {
      email,
      displayName,
      password: 'correct horse battery staple',
      requestedRole: role,
    },
  });
  expect(registration.statusCode).toBe(201);
  const login = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: 'correct horse battery staple' },
  });
  expect(login.statusCode).toBe(200);
  const refreshCookie = cookieValue(login.headers['set-cookie']);
  expect(refreshCookie).toBeDefined();
  return {
    accessToken: login.json().accessToken as string,
    actorId: registration.json().actor.id as string,
    refreshCookie: refreshCookie as string,
  };
}

async function createTrip(
  server: FastifyInstance,
  accessToken: string,
): Promise<string> {
  const quote = await server.inject({
    method: 'POST',
    url: '/api/v1/pricing/fare-quotes',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'idempotency-key': randomUUID(),
    },
    payload: {
      pickup: {
        label: 'Realtime pickup',
        latitude: 21.0285,
        longitude: 105.8048,
      },
      dropoff: {
        label: 'Realtime dropoff',
        latitude: 21.033,
        longitude: 105.835,
      },
      serviceType: 'MOTORBIKE_STANDARD',
    },
  });
  expect(quote.statusCode).toBe(201);
  const trip = await server.inject({
    method: 'POST',
    url: '/api/v1/trips',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'idempotency-key': randomUUID(),
    },
    payload: { fareQuoteId: quote.json().id },
  });
  expect(trip.statusCode).toBe(201);
  return trip.json().id as string;
}

async function authenticateSocket(
  socket: WebSocket,
  accessToken: string,
): Promise<void> {
  const authenticated = nextMessage(
    socket,
    (message) => message.type === 'authenticated',
    'authenticated',
  );
  socket.send(JSON.stringify({ type: 'authenticate', accessToken }));
  await authenticated;
}

function connect(url: string, origin?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      url,
      origin ? { headers: { origin } } : undefined,
    );
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out opening WebSocket connection'));
    }, 3_000);
    socket.once('open', () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timeout);
      socket.terminate();
      reject(
        new Error(`Unexpected WebSocket response: ${response.statusCode}`),
      );
    });
  });
}

function nextMessage(
  socket: WebSocket,
  predicate: (message: any) => boolean,
  label: string,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`Timed out waiting for WebSocket ${label}`));
    }, 3_000);
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as any;
      if (message.type === 'error') {
        clearTimeout(timeout);
        socket.off('message', onMessage);
        reject(new Error(`WebSocket error: ${message.code}`));
        return;
      }
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      resolve(message);
    };
    socket.on('message', onMessage);
  });
}

function nextServerMessage(
  socket: WebSocket,
  predicate: (message: any) => boolean,
  label: string,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`Timed out waiting for WebSocket ${label}`));
    }, 3_000);
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as any;
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      resolve(message);
    };
    socket.on('message', onMessage);
  });
}

function nextClose(
  socket: WebSocket,
  label: string,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('close', onClose);
      reject(new Error(`Timed out waiting for WebSocket ${label}`));
    }, 3_000);
    const onClose = (code: number, reason: Buffer) => {
      clearTimeout(timeout);
      resolve({ code, reason: reason.toString() });
    };
    socket.once('close', onClose);
  });
}

function cookieValue(
  header: string | string[] | undefined,
): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.split(';', 1)[0];
}

function expectNoMatchingMessage(
  socket: WebSocket,
  predicate: (message: any) => boolean,
  durationMilliseconds: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('message', onMessage);
      resolve();
    }, durationMilliseconds);
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as any;
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      reject(
        new Error(
          `Received an unexpected WebSocket message: ${JSON.stringify(message)}`,
        ),
      );
    };
    socket.on('message', onMessage);
  });
}

function realtimeLocation(sequenceNumber: number) {
  return {
    latitude: 21.0285 + sequenceNumber / 100_000,
    longitude: 105.8048 + sequenceNumber / 100_000,
    accuracyMeters: 5,
    source: 'SIMULATOR',
    sequenceNumber,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
