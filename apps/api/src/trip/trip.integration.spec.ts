import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseService } from '../database/database.service.js';
import { createApplication } from '../main.js';

describe('Quote and Trip HTTP seam', () => {
  let app: Awaited<ReturnType<typeof createApplication>>;
  let server: FastifyInstance;
  let database: DatabaseService;
  const password = 'correct horse battery staple';

  beforeAll(async () => {
    app = await createApplication();
    await app.init();
    server = app.getHttpAdapter().getInstance();
    database = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('replays a quote and creates one idempotent requested Trip', async () => {
    const accessToken = await customerToken();
    const quoteKey = randomUUID();
    const firstQuote = await createQuote(accessToken, quoteKey);
    expect(firstQuote.statusCode).toBe(201);
    expect(firstQuote.json()).toMatchObject({
      route: {
        provider: 'coordinate-fallback',
        usedFallback: true,
        fallbackReason: 'PRIMARY_NOT_CONFIGURED',
        geometry: { type: 'LineString' },
      },
    });

    const replayedQuote = await createQuote(accessToken, quoteKey);
    expect(replayedQuote.statusCode).toBe(201);
    expect(replayedQuote.json().id).toBe(firstQuote.json().id);

    const tripKey = randomUUID();
    const [firstTrip, replayedTrip] = await Promise.all([
      createTrip(accessToken, firstQuote.json().id, tripKey),
      createTrip(accessToken, firstQuote.json().id, tripKey),
    ]);
    expect(firstTrip.statusCode).toBe(201);
    expect(replayedTrip.statusCode).toBe(201);
    expect(replayedTrip.json().id).toBe(firstTrip.json().id);
    expect(firstTrip.json()).toMatchObject({
      fareQuoteId: firstQuote.json().id,
      state: 'REQUESTED',
      version: 0,
    });

    const current = await server.inject({
      method: 'GET',
      url: '/api/v1/trips/current',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({
      id: firstTrip.json().id,
      state: 'REQUESTED',
      pickup: {
        label: 'Demo pickup',
        latitude: 21.0285,
        longitude: 105.8048,
      },
      dropoff: {
        label: 'Demo dropoff',
        latitude: 21.033,
        longitude: 105.835,
      },
    });
  });

  it('allows only one command to consume one Fare Quote', async () => {
    const accessToken = await customerToken();
    const quote = await createQuote(accessToken, randomUUID());
    expect(quote.statusCode).toBe(201);

    const [first, second] = await Promise.all([
      createTrip(accessToken, quote.json().id, randomUUID()),
      createTrip(accessToken, quote.json().id, randomUUID()),
    ]);
    const outcomes = [first, second].sort(
      (left, right) => left.statusCode - right.statusCode,
    );
    expect(outcomes[0]?.statusCode).toBe(201);
    expect(outcomes[1]?.statusCode).toBe(409);
    expect(outcomes[1]?.json().code).toBe('FARE_QUOTE_ALREADY_CONSUMED');
  });

  it('rejects a second active Trip for the same Customer', async () => {
    const accessToken = await customerToken();
    const firstQuote = await createQuote(accessToken, randomUUID());
    const firstTrip = await createTrip(
      accessToken,
      firstQuote.json().id,
      randomUUID(),
    );
    expect(firstTrip.statusCode).toBe(201);

    const secondQuote = await createQuote(accessToken, randomUUID());
    const secondTrip = await createTrip(
      accessToken,
      secondQuote.json().id,
      randomUUID(),
    );
    expect(secondTrip.statusCode).toBe(409);
    expect(secondTrip.json().code).toBe('ACTIVE_TRIP_EXISTS');
  });

  it('allows a Customer to idempotently cancel their requested Trip', async () => {
    const accessToken = await customerToken();
    const quote = await createQuote(accessToken, randomUUID());
    expect(quote.statusCode).toBe(201);
    const trip = await createTrip(accessToken, quote.json().id, randomUUID());
    expect(trip.statusCode).toBe(201);

    const cancellationKey = randomUUID();
    const first = await server.inject({
      method: 'POST',
      url: `/api/v1/trips/${trip.json().id}/cancel`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': cancellationKey,
      },
      payload: { reasonCode: 'CHANGE_OF_PLANS' },
    });
    const replay = await server.inject({
      method: 'POST',
      url: `/api/v1/trips/${trip.json().id}/cancel`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': cancellationKey,
      },
      payload: { reasonCode: 'CHANGE_OF_PLANS' },
    });

    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      id: trip.json().id,
      state: 'CANCELLED',
      version: 1,
      cancellation: {
        cancelledByRole: 'CUSTOMER',
        reasonCode: 'CHANGE_OF_PLANS',
        ruleCode: 'CUSTOMER_PRE_TRIP',
      },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
  });

  it('releases a pending Trip Offer and Driver reservation when a Customer cancels during matching', async () => {
    const accessToken = await customerToken();
    const driver = await driverSession();
    await setAllAvailableDriversOffline();
    await approveDriver(driver.actorId);
    await sendLocationAndGoOnline(driver.accessToken);

    const quote = await createQuote(accessToken, randomUUID());
    expect(quote.statusCode).toBe(201);
    const trip = await createTrip(accessToken, quote.json().id, randomUUID());
    expect(trip.statusCode).toBe(201);

    const matching = await server.inject({
      method: 'POST',
      url: `/api/v1/dispatch/trips/${trip.json().id}/match`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': randomUUID(),
      },
    });
    expect(matching.statusCode).toBe(201);
    expect(matching.json()).toMatchObject({
      tripState: 'MATCHING',
      offer: { driverId: driver.actorId, status: 'PENDING' },
    });

    const cancellation = await cancelTrip(
      accessToken,
      trip.json().id as string,
      randomUUID(),
      { reasonCode: 'CHANGE_OF_PLANS' },
    );
    expect(cancellation.statusCode).toBe(201);
    expect(cancellation.json()).toMatchObject({
      state: 'CANCELLED',
      version: 2,
      driverId: null,
    });

    const state = await database.query<{
      trip_state: string;
      offer_status: string;
      reservation_status: string;
      work_state: string;
      current_trip_id: string | null;
      cancelled_events: string;
    }>(
      `SELECT t.state AS trip_state,
              o.status AS offer_status,
              r.status AS reservation_status,
              ws.work_state,
              ws.current_trip_id,
              (SELECT count(*)::text FROM trip.outbox_events
               WHERE trip_id = t.id AND event_type = 'trip.cancelled') AS cancelled_events
       FROM trip.trips t
       JOIN dispatch.trip_offers o ON o.trip_id = t.id
       JOIN dispatch.driver_reservations r ON r.id = o.reservation_id
       JOIN dispatch.driver_work_states ws ON ws.driver_user_id = o.driver_user_id
       WHERE t.id = $1`,
      [trip.json().id],
    );
    expect(state.rows[0]).toEqual({
      trip_state: 'CANCELLED',
      offer_status: 'REVOKED',
      reservation_status: 'RELEASED',
      work_state: 'AVAILABLE',
      current_trip_id: null,
      cancelled_events: '1',
    });
  });

  it('cancels an assigned Trip and releases the Driver assignment atomically', async () => {
    const accessToken = await customerToken();
    const driver = await driverSession();
    await setAllAvailableDriversOffline();
    await approveDriver(driver.actorId);
    await sendLocationAndGoOnline(driver.accessToken);

    const quote = await createQuote(accessToken, randomUUID());
    expect(quote.statusCode).toBe(201);
    const trip = await createTrip(accessToken, quote.json().id, randomUUID());
    expect(trip.statusCode).toBe(201);
    const tripId = trip.json().id as string;

    const matching = await server.inject({
      method: 'POST',
      url: `/api/v1/dispatch/trips/${tripId}/match`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': randomUUID(),
      },
    });
    expect(matching.statusCode).toBe(201);
    const offerId = matching.json().offer.id as string;
    const accepted = await server.inject({
      method: 'POST',
      url: `/api/v1/dispatch/offers/${offerId}/accept`,
      headers: {
        authorization: `Bearer ${driver.accessToken}`,
        'idempotency-key': randomUUID(),
      },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({
      tripId,
      status: 'ACCEPTED',
      tripState: 'DRIVER_TO_PICKUP',
    });

    const cancellation = await cancelTrip(accessToken, tripId, randomUUID(), {
      reasonCode: 'CHANGE_OF_PLANS',
    });
    expect(cancellation.statusCode).toBe(201);
    expect(cancellation.json()).toMatchObject({
      id: tripId,
      state: 'CANCELLED',
      version: 3,
      driverId: driver.actorId,
    });

    const state = await database.query<{
      trip_state: string;
      assignment_status: string;
      work_state: string;
      current_trip_id: string | null;
      cancelled_events: string;
    }>(
      `SELECT t.state AS trip_state,
              a.status AS assignment_status,
              ws.work_state,
              ws.current_trip_id,
              (SELECT count(*)::text FROM trip.outbox_events
               WHERE trip_id = t.id AND event_type = 'trip.cancelled') AS cancelled_events
       FROM trip.trips t
       JOIN dispatch.assignments a ON a.trip_id = t.id
       JOIN dispatch.driver_work_states ws ON ws.driver_user_id = a.driver_user_id
       WHERE t.id = $1`,
      [tripId],
    );
    expect(state.rows[0]).toEqual({
      trip_state: 'CANCELLED',
      assignment_status: 'CANCELLED',
      work_state: 'AVAILABLE',
      current_trip_id: null,
      cancelled_events: '1',
    });
  });

  it('serializes concurrent acceptance and Customer cancellation without a split assignment', async () => {
    const accessToken = await customerToken();
    const driver = await driverSession();
    await setAllAvailableDriversOffline();
    await approveDriver(driver.actorId);
    await sendLocationAndGoOnline(driver.accessToken);

    const quote = await createQuote(accessToken, randomUUID());
    const trip = await createTrip(accessToken, quote.json().id, randomUUID());
    const tripId = trip.json().id as string;
    const matching = await server.inject({
      method: 'POST',
      url: `/api/v1/dispatch/trips/${tripId}/match`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': randomUUID(),
      },
    });
    expect(matching.statusCode).toBe(201);
    const offerId = matching.json().offer.id as string;

    const [accepted, cancelled] = await Promise.all([
      server.inject({
        method: 'POST',
        url: `/api/v1/dispatch/offers/${offerId}/accept`,
        headers: {
          authorization: `Bearer ${driver.accessToken}`,
          'idempotency-key': randomUUID(),
        },
      }),
      cancelTrip(accessToken, tripId, randomUUID(), {
        reasonCode: 'CHANGE_OF_PLANS',
      }),
    ]);

    expect(cancelled.statusCode).toBe(201);
    expect([201, 409]).toContain(accepted.statusCode);
    expect(accepted.statusCode).not.toBe(500);

    const state = await database.query<{
      trip_state: string;
      active_assignments: string;
      active_reservations: string;
      active_offers: string;
    }>(
      `SELECT t.state AS trip_state,
              (SELECT count(*)::text FROM dispatch.assignments
               WHERE trip_id = t.id AND status = 'ACTIVE') AS active_assignments,
              (SELECT count(*)::text FROM dispatch.driver_reservations
               WHERE trip_id = t.id AND status = 'ACTIVE') AS active_reservations,
              (SELECT count(*)::text FROM dispatch.trip_offers
               WHERE trip_id = t.id AND status = 'PENDING') AS active_offers
       FROM trip.trips t
       WHERE t.id = $1`,
      [tripId],
    );
    expect(state.rows[0]).toEqual({
      trip_state: 'CANCELLED',
      active_assignments: '0',
      active_reservations: '0',
      active_offers: '0',
    });
  });

  it('serializes concurrent Customer cancellations into one transition and one cancellation record', async () => {
    const accessToken = await customerToken();
    const quote = await createQuote(accessToken, randomUUID());
    expect(quote.statusCode).toBe(201);
    const trip = await createTrip(accessToken, quote.json().id, randomUUID());
    expect(trip.statusCode).toBe(201);

    const [first, second] = await Promise.all([
      cancelTrip(accessToken, trip.json().id as string, randomUUID(), {
        reasonCode: 'CHANGE_OF_PLANS',
      }),
      cancelTrip(accessToken, trip.json().id as string, randomUUID(), {
        reasonCode: 'SAFETY_CONCERN',
      }),
    ]);
    const outcomes = [first, second].sort(
      (left, right) => left.statusCode - right.statusCode,
    );
    expect(outcomes[0]?.statusCode).toBe(201);
    expect(outcomes[1]?.statusCode).toBe(409);
    expect(outcomes[1]?.json().code).toBe('TRIP_CANCELLATION_NOT_ALLOWED');

    const records = await database.query<{
      cancellations: string;
      transitions: string;
      events: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM trip.cancellations WHERE trip_id = $1) AS cancellations,
         (SELECT count(*)::text FROM trip.state_transitions WHERE trip_id = $1 AND command = 'CANCEL_TRIP') AS transitions,
         (SELECT count(*)::text FROM trip.outbox_events WHERE trip_id = $1 AND event_type = 'trip.cancelled') AS events`,
      [trip.json().id],
    );
    expect(records.rows[0]).toEqual({
      cancellations: '1',
      transitions: '1',
      events: '1',
    });
  });

  it('rejects a different cancellation payload under a reused idempotency key', async () => {
    const accessToken = await customerToken();
    const quote = await createQuote(accessToken, randomUUID());
    expect(quote.statusCode).toBe(201);
    const trip = await createTrip(accessToken, quote.json().id, randomUUID());
    expect(trip.statusCode).toBe(201);
    const idempotencyKey = randomUUID();

    const first = await cancelTrip(
      accessToken,
      trip.json().id as string,
      idempotencyKey,
      { reasonCode: 'CHANGE_OF_PLANS' },
    );
    expect(first.statusCode).toBe(201);

    const reused = await cancelTrip(
      accessToken,
      trip.json().id as string,
      idempotencyKey,
      { reasonCode: 'OTHER', reasonDetail: 'The plan changed again.' },
    );
    expect(reused.statusCode).toBe(409);
    expect(reused.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('rejects a quote outside the synthetic service area', async () => {
    const accessToken = await customerToken();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/pricing/fare-quotes',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: {
        pickup: { label: 'Outside', latitude: 0, longitude: 0 },
        dropoff: {
          label: 'Demo dropoff',
          latitude: 21.033,
          longitude: 105.835,
        },
        serviceType: 'MOTORBIKE_STANDARD',
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('OUTSIDE_SERVICE_AREA');
  });

  async function customerToken(): Promise<string> {
    const email = `quote.customer.${randomUUID()}@gove.test`;
    const registered = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'idempotency-key': randomUUID() },
      payload: {
        email,
        displayName: 'Quote Customer',
        password,
        requestedRole: 'CUSTOMER',
      },
    });
    expect(registered.statusCode).toBe(201);
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    return login.json().accessToken as string;
  }

  function createQuote(accessToken: string, idempotencyKey: string) {
    return server.inject({
      method: 'POST',
      url: '/api/v1/pricing/fare-quotes',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': idempotencyKey,
      },
      payload: {
        pickup: {
          label: 'Demo pickup',
          latitude: 21.0285,
          longitude: 105.8048,
        },
        dropoff: {
          label: 'Demo dropoff',
          latitude: 21.033,
          longitude: 105.835,
        },
        serviceType: 'MOTORBIKE_STANDARD',
      },
    });
  }

  function createTrip(
    accessToken: string,
    fareQuoteId: string,
    idempotencyKey: string,
  ) {
    return server.inject({
      method: 'POST',
      url: '/api/v1/trips',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': idempotencyKey,
      },
      payload: { fareQuoteId },
    });
  }

  function cancelTrip(
    accessToken: string,
    tripId: string,
    idempotencyKey: string,
    payload: { reasonCode: string; reasonDetail?: string },
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/trips/${tripId}/cancel`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': idempotencyKey,
      },
      payload,
    });
  }

  async function driverSession(): Promise<{
    accessToken: string;
    actorId: string;
  }> {
    const email = `trip.driver.${randomUUID()}@gove.test`;
    const registered = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'idempotency-key': randomUUID() },
      payload: {
        email,
        displayName: 'Trip Driver',
        password,
        requestedRole: 'DRIVER',
      },
    });
    expect(registered.statusCode).toBe(201);
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    return {
      accessToken: login.json().accessToken as string,
      actorId: registered.json().actor.id as string,
    };
  }

  async function approveDriver(driverId: string): Promise<void> {
    await database.query(
      `UPDATE driver.driver_profiles
       SET approval_status = 'APPROVED', reviewed_at = now()
       WHERE user_id = $1`,
      [driverId],
    );
    await database.query(
      `INSERT INTO driver.vehicles (
         id, driver_user_id, vehicle_class, make, model, model_year,
         plate_normalized, approval_status, is_selected
       ) VALUES ($1, $2, 'MOTORBIKE', 'Demo', 'Trip', 2024, $3, 'APPROVED', true)`,
      [
        randomUUID(),
        driverId,
        `TR${randomUUID().replaceAll('-', '').slice(0, 14).toUpperCase()}`,
      ],
    );
  }

  async function sendLocationAndGoOnline(accessToken: string): Promise<void> {
    const location = await server.inject({
      method: 'PUT',
      url: '/api/v1/drivers/me/location',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        latitude: 21.0285,
        longitude: 105.8048,
        accuracyMeters: 10,
        source: 'SIMULATOR',
        sequenceNumber: 1,
      },
    });
    expect(location.statusCode).toBe(200);
    const workState = await server.inject({
      method: 'PUT',
      url: '/api/v1/drivers/me/work-state',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { state: 'AVAILABLE' },
    });
    expect(workState.statusCode).toBe(200);
  }

  async function setAllAvailableDriversOffline(): Promise<void> {
    await database.query(
      `UPDATE dispatch.driver_work_states
       SET work_state = 'OFFLINE', current_trip_id = NULL,
           state_version = state_version + 1, state_changed_at = now(), updated_at = now()
       WHERE work_state = 'AVAILABLE'`,
    );
  }
});
