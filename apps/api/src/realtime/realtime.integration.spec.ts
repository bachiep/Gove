import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { DatabaseService } from '../database/database.service.js';
import { createApplication } from '../main.js';

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
          latitude: 10.76,
          longitude: 106.68,
        },
        dropoff: {
          label: 'Realtime dropoff',
          latitude: 10.78,
          longitude: 106.7,
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
        latitude: 10.76,
        longitude: 106.68,
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
            latitude: 10.761,
            longitude: 106.681,
            accuracyMeters: 4,
            source: 'SIMULATOR',
            sequenceNumber: 2,
          },
        }),
      );
      expect((await acceptedLocationPromise).sequenceNumber).toBe('2');
      expect((await customerLocationPromise).driverId).toBe(driver.actorId);
    } finally {
      customerSocket.close();
      driverSocket.close();
    }
  });
});

async function registerAndLogin(
  server: FastifyInstance,
  role: 'CUSTOMER' | 'DRIVER',
  displayName: string,
): Promise<{ accessToken: string; actorId: string }> {
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
  return {
    accessToken: login.json().accessToken as string,
    actorId: registration.json().actor.id as string,
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
      pickup: { label: 'Realtime pickup', latitude: 10.76, longitude: 106.68 },
      dropoff: { label: 'Realtime dropoff', latitude: 10.78, longitude: 106.7 },
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

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
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
