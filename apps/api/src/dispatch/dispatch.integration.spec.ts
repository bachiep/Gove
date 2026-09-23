import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../main.js';
import { DatabaseService } from '../database/database.service.js';

describe('Dispatch HTTP seam', () => {
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

  it('offers one fresh eligible Driver and commits one concurrent acceptance', async () => {
    const customer = await registerAndLogin('CUSTOMER', 'Dispatch Customer');
    const driver = await registerAndLogin('DRIVER', 'Dispatch Driver');
    await approveDriver(driver.actorId, 'dispatch-accept');
    await sendLocationAndGoOnline(driver.accessToken);

    const tripId = await createRequestedTrip(customer.accessToken);
    const matchingKey = randomUUID();
    const matching = await startMatching(
      customer.accessToken,
      tripId,
      matchingKey,
    );
    const matchingReplay = await startMatching(
      customer.accessToken,
      tripId,
      matchingKey,
    );
    expect(matching.statusCode).toBe(201);
    expect(matchingReplay.statusCode).toBe(201);
    expect(matchingReplay.json()).toEqual(matching.json());
    expect(matching.json()).toMatchObject({
      tripId,
      tripState: 'MATCHING',
      tripVersion: 1,
      offer: { status: 'PENDING', driverId: driver.actorId, attemptNumber: 1 },
    });

    const offerId = matching.json().offer.id as string;
    const acceptKey = randomUUID();
    const [first, retry] = await Promise.all([
      acceptOffer(driver.accessToken, offerId, acceptKey),
      acceptOffer(driver.accessToken, offerId, acceptKey),
    ]);
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      id: offerId,
      status: 'ACCEPTED',
      tripState: 'DRIVER_TO_PICKUP',
      tripVersion: 2,
    });
    expect(retry.json()).toEqual(first.json());

    const workState = await database.query<{
      work_state: string;
      current_trip_id: string;
    }>(
      `SELECT work_state, current_trip_id
       FROM dispatch.driver_work_states WHERE driver_user_id = $1`,
      [driver.actorId],
    );
    expect(workState.rows[0]).toMatchObject({
      work_state: 'TO_PICKUP',
      current_trip_id: tripId,
    });
  });

  it('expires an offer atomically and releases the Driver reservation', async () => {
    const customer = await registerAndLogin('CUSTOMER', 'Expiry Customer');
    const driver = await registerAndLogin('DRIVER', 'Expiry Driver');
    await approveDriver(driver.actorId, 'dispatch-expiry');
    await sendLocationAndGoOnline(driver.accessToken);

    const tripId = await createRequestedTrip(customer.accessToken);
    const matching = await startMatching(customer.accessToken, tripId);
    const offerId = matching.json().offer.id as string;
    await database.query(
      `UPDATE dispatch.trip_offers
       SET offered_at = now() - INTERVAL '1 minute', expires_at = now() - INTERVAL '1 second'
       WHERE id = $1`,
      [offerId],
    );
    await database.query(
      `UPDATE dispatch.driver_reservations
       SET created_at = now() - INTERVAL '1 minute', expires_at = now() - INTERVAL '1 second'
       WHERE trip_id = $1 AND driver_user_id = $2 AND status = 'ACTIVE'`,
      [tripId, driver.actorId],
    );

    const response = await acceptOffer(
      driver.accessToken,
      offerId,
      randomUUID(),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('OFFER_EXPIRED');

    const workState = await database.query<{ work_state: string }>(
      `SELECT work_state FROM dispatch.driver_work_states WHERE driver_user_id = $1`,
      [driver.actorId],
    );
    expect(workState.rows[0]?.work_state).toBe('AVAILABLE');
  });

  it('moves a Trip to NO_DRIVER_AVAILABLE when all locations are stale', async () => {
    const customer = await registerAndLogin('CUSTOMER', 'No Driver Customer');
    const driver = await registerAndLogin('DRIVER', 'Stale Driver');
    await approveDriver(driver.actorId, 'dispatch-stale');
    await database.query(
      `UPDATE dispatch.driver_work_states
       SET work_state = 'OFFLINE', state_version = state_version + 1,
           state_changed_at = now(), updated_at = now()
       WHERE work_state = 'AVAILABLE'`,
    );
    await sendLocationAndGoOnline(driver.accessToken);
    await database.query(
      `UPDATE location.latest_driver_locations
       SET captured_at = now() - INTERVAL '1 hour', received_at = now() - INTERVAL '1 hour'
       WHERE driver_user_id = $1`,
      [driver.actorId],
    );

    const tripId = await createRequestedTrip(customer.accessToken);
    const matching = await startMatching(customer.accessToken, tripId);
    expect(matching.statusCode).toBe(201);
    expect(matching.json()).toMatchObject({
      tripId,
      tripState: 'NO_DRIVER_AVAILABLE',
      offer: null,
    });
  });

  async function registerAndLogin(
    role: 'CUSTOMER' | 'DRIVER',
    displayName: string,
  ): Promise<{ accessToken: string; actorId: string }> {
    const email = `${role.toLowerCase()}.${randomUUID()}@gove.test`;
    const registration = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'idempotency-key': randomUUID() },
      payload: { email, displayName, password, requestedRole: role },
    });
    expect(registration.statusCode).toBe(201);
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    return {
      accessToken: login.json().accessToken as string,
      actorId: registration.json().actor.id as string,
    };
  }

  async function approveDriver(
    driverId: string,
    _suffix: string,
  ): Promise<void> {
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
       ) VALUES ($1, $2, 'MOTORBIKE', 'Demo', 'Dispatch', 2024, $3, 'APPROVED', true)`,
      [
        randomUUID(),
        driverId,
        `M3${randomUUID().replaceAll('-', '').slice(0, 14).toUpperCase()}`,
      ],
    );
  }

  async function sendLocationAndGoOnline(accessToken: string): Promise<void> {
    const location = await server.inject({
      method: 'PUT',
      url: '/api/v1/drivers/me/location',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        latitude: 10.76,
        longitude: 106.68,
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

  async function createRequestedTrip(accessToken: string): Promise<string> {
    const quote = await server.inject({
      method: 'POST',
      url: '/api/v1/pricing/fare-quotes',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: {
        pickup: {
          label: 'Dispatch pickup',
          latitude: 10.76,
          longitude: 106.68,
        },
        dropoff: {
          label: 'Dispatch dropoff',
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
    return trip.json().id as string;
  }

  function startMatching(
    accessToken: string,
    tripId: string,
    idempotencyKey = randomUUID(),
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/dispatch/trips/${tripId}/match`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': idempotencyKey,
      },
    });
  }

  function acceptOffer(
    accessToken: string,
    offerId: string,
    idempotencyKey: string,
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/dispatch/offers/${offerId}/accept`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': idempotencyKey,
      },
    });
  }
});
