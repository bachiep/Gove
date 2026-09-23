import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseService } from '../database/database.service.js';
import { createApplication } from '../main.js';

describe('Payment and history HTTP seam', () => {
  let app: Awaited<ReturnType<typeof createApplication>>;
  let server: FastifyInstance;
  let database: DatabaseService;
  let locationSequence = 0;
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

  it('captures one completed Trip idempotently and exposes owned history', async () => {
    const driver = await createDriver('Payment Driver');
    const customer = await registerAndLogin('CUSTOMER', 'Payment Customer');
    const trip = await completeTrip(customer.accessToken, driver);
    const captureKey = randomUUID();

    const [first, replay] = await Promise.all([
      capture(customer.accessToken, trip.id, captureKey),
      capture(customer.accessToken, trip.id, captureKey),
    ]);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(first.json()).toMatchObject({
      tripId: trip.id,
      attemptNumber: 1,
      amountMinor: trip.finalFareMinor,
      currency: 'VND',
      status: 'SUCCEEDED',
    });

    const payment = await server.inject({
      method: 'GET',
      url: `/api/v1/payments/trips/${trip.id}`,
      headers: { authorization: `Bearer ${customer.accessToken}` },
    });
    expect(payment.statusCode).toBe(200);
    expect(payment.json()).toEqual(first.json());

    const customerHistory = await server.inject({
      method: 'GET',
      url: '/api/v1/trips/history',
      headers: { authorization: `Bearer ${customer.accessToken}` },
    });
    expect(customerHistory.statusCode).toBe(200);
    expect(customerHistory.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: trip.id,
          state: 'COMPLETED',
          finalFareMinor: trip.finalFareMinor,
          paymentStatus: 'SUCCEEDED',
        }),
      ]),
    );

    const driverHistory = await server.inject({
      method: 'GET',
      url: '/api/v1/trips/history',
      headers: { authorization: `Bearer ${driver.accessToken}` },
    });
    expect(driverHistory.statusCode).toBe(200);
    expect(driverHistory.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: trip.id })]),
    );

    const otherCustomer = await registerAndLogin(
      'CUSTOMER',
      'Other Payment Customer',
    );
    const forbiddenPayment = await server.inject({
      method: 'GET',
      url: `/api/v1/payments/trips/${trip.id}`,
      headers: { authorization: `Bearer ${otherCustomer.accessToken}` },
    });
    expect(forbiddenPayment.statusCode).toBe(404);
    expect(forbiddenPayment.json().code).toBe('PAYMENT_NOT_FOUND');

    const secondCapture = await capture(
      customer.accessToken,
      trip.id,
      randomUUID(),
    );
    expect(secondCapture.statusCode).toBe(409);
    expect(secondCapture.json().code).toBe('PAYMENT_ALREADY_SUCCEEDED');
  });

  it('persists failed, pending, and unknown simulator outcomes with safe retry rules', async () => {
    const driver = await createDriver('Simulator Driver');

    const failedTrip = await completeTrip(
      (await registerAndLogin('CUSTOMER', 'Failed Payment Customer'))
        .accessToken,
      driver,
    );
    const failed = await capture(
      failedTrip.customerToken,
      failedTrip.id,
      randomUUID(),
      'FAILED',
    );
    expect(failed.statusCode).toBe(201);
    expect(failed.json()).toMatchObject({
      status: 'FAILED',
      failureCode: 'SIMULATED_FAILURE',
    });
    const retried = await capture(
      failedTrip.customerToken,
      failedTrip.id,
      randomUUID(),
      'SUCCEEDED',
    );
    expect(retried.statusCode).toBe(201);
    expect(retried.json()).toMatchObject({
      attemptNumber: 2,
      status: 'SUCCEEDED',
    });

    const unknownTrip = await completeTrip(
      (await registerAndLogin('CUSTOMER', 'Unknown Payment Customer'))
        .accessToken,
      driver,
    );
    const unknown = await capture(
      unknownTrip.customerToken,
      unknownTrip.id,
      randomUUID(),
      'UNKNOWN',
    );
    expect(unknown.statusCode).toBe(201);
    expect(unknown.json()).toMatchObject({
      status: 'UNKNOWN',
      failureCode: 'SIMULATED_TIMEOUT',
    });
    const unknownRetry = await capture(
      unknownTrip.customerToken,
      unknownTrip.id,
      randomUUID(),
      'SUCCEEDED',
    );
    expect(unknownRetry.statusCode).toBe(409);
    expect(unknownRetry.json().code).toBe('PAYMENT_RECONCILIATION_REQUIRED');

    const pendingTrip = await completeTrip(
      (await registerAndLogin('CUSTOMER', 'Pending Payment Customer'))
        .accessToken,
      driver,
    );
    const pending = await capture(
      pendingTrip.customerToken,
      pendingTrip.id,
      randomUUID(),
      'PENDING',
    );
    expect(pending.statusCode).toBe(201);
    expect(pending.json()).toMatchObject({ status: 'PENDING' });
    const pendingRetry = await capture(
      pendingTrip.customerToken,
      pendingTrip.id,
      randomUUID(),
      'SUCCEEDED',
    );
    expect(pendingRetry.statusCode).toBe(409);
    expect(pendingRetry.json().code).toBe('PAYMENT_PENDING');
  });

  async function createDriver(displayName: string) {
    await setAllAvailableDriversOffline();
    const driver = await registerAndLogin('DRIVER', displayName);
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
       ) VALUES ($1, $2, 'MOTORBIKE', 'Demo', 'Payment', 2024, $3, 'APPROVED', true)`,
      [
        randomUUID(),
        driver.actorId,
        `PAY${randomUUID().replaceAll('-', '').slice(0, 14).toUpperCase()}`,
      ],
    );
    return driver;
  }

  async function completeTrip(
    customerToken: string,
    driver: { accessToken: string; actorId: string },
  ): Promise<{
    id: string;
    finalFareMinor: number;
    customerToken: string;
  }> {
    const location = await server.inject({
      method: 'PUT',
      url: '/api/v1/drivers/me/location',
      headers: { authorization: `Bearer ${driver.accessToken}` },
      payload: {
        latitude: 10.76,
        longitude: 106.68,
        accuracyMeters: 10,
        source: 'SIMULATOR',
        sequenceNumber: ++locationSequence,
      },
    });
    expect(location.statusCode).toBe(200);
    const online = await server.inject({
      method: 'PUT',
      url: '/api/v1/drivers/me/work-state',
      headers: { authorization: `Bearer ${driver.accessToken}` },
      payload: { state: 'AVAILABLE' },
    });
    expect(online.statusCode).toBe(200);

    const quote = await server.inject({
      method: 'POST',
      url: '/api/v1/pricing/fare-quotes',
      headers: {
        authorization: `Bearer ${customerToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: {
        pickup: { label: 'Payment pickup', latitude: 10.76, longitude: 106.68 },
        dropoff: {
          label: 'Payment dropoff',
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
        authorization: `Bearer ${customerToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: { fareQuoteId: quote.json().id },
    });
    expect(trip.statusCode).toBe(201);
    const tripId = trip.json().id as string;
    const matching = await server.inject({
      method: 'POST',
      url: `/api/v1/dispatch/trips/${tripId}/match`,
      headers: {
        authorization: `Bearer ${customerToken}`,
        'idempotency-key': randomUUID(),
      },
    });
    expect(matching.statusCode).toBe(201);
    const accepted = await server.inject({
      method: 'POST',
      url: `/api/v1/dispatch/offers/${matching.json().offer.id}/accept`,
      headers: {
        authorization: `Bearer ${driver.accessToken}`,
        'idempotency-key': randomUUID(),
      },
    });
    expect(accepted.statusCode).toBe(201);
    const arrived = await transition(driver.accessToken, tripId, 'arrive');
    expect(arrived.statusCode).toBe(201);
    const started = await transition(driver.accessToken, tripId, 'start');
    expect(started.statusCode).toBe(201);
    const completed = await server.inject({
      method: 'POST',
      url: `/api/v1/dispatch/trips/${tripId}/complete`,
      headers: {
        authorization: `Bearer ${driver.accessToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: { actualDistanceMeters: 2_500, actualDurationSeconds: 420 },
    });
    expect(completed.statusCode).toBe(201);
    return {
      id: tripId,
      finalFareMinor: completed.json().finalFareMinor as number,
      customerToken,
    };
  }

  async function transition(
    accessToken: string,
    tripId: string,
    action: 'arrive' | 'start',
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/dispatch/trips/${tripId}/${action}`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': randomUUID(),
      },
    });
  }

  function capture(
    accessToken: string,
    tripId: string,
    idempotencyKey: string,
    simulationOutcome = 'SUCCEEDED',
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/payments/trips/${tripId}/capture`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': idempotencyKey,
      },
      payload: { simulationOutcome },
    });
  }

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

  async function setAllAvailableDriversOffline(): Promise<void> {
    await database.query(
      `UPDATE dispatch.driver_work_states
       SET work_state = 'OFFLINE', current_trip_id = NULL,
           state_version = state_version + 1,
           state_changed_at = now(), updated_at = now()
       WHERE work_state = 'AVAILABLE'`,
    );
  }
});
