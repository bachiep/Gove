import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseService } from '../database/database.service.js';
import { createApplication } from '../main.js';

describe('Operator diagnostic HTTP seam', () => {
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

  it('protects the PII-minimized timeline and durably audits a reasoned review', async () => {
    const customer = await registerCustomer();
    const tripId = await createTrip(customer.accessToken);

    const unauthenticated = await server.inject({
      method: 'GET',
      url: `/api/v1/operator/trips/${tripId}/timeline`,
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json().code).toBe('AUTH_REQUIRED');

    const customerRead = await server.inject({
      method: 'GET',
      url: `/api/v1/operator/trips/${tripId}/timeline`,
      headers: { authorization: `Bearer ${customer.accessToken}` },
    });
    expect(customerRead.statusCode).toBe(403);
    expect(customerRead.json().code).toBe('AUTH_FORBIDDEN');

    await database.query(
      `INSERT INTO identity.user_roles (user_id, role_code)
       VALUES ($1, 'OPERATOR')`,
      [customer.userId],
    );
    const operatorToken = await login(customer.email);

    const absentTrip = await server.inject({
      method: 'GET',
      url: `/api/v1/operator/trips/${randomUUID()}/timeline`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(absentTrip.statusCode).toBe(404);
    expect(absentTrip.json().code).toBe('TRIP_NOT_FOUND');

    const timeline = await server.inject({
      method: 'GET',
      url: `/api/v1/operator/trips/${tripId}/timeline`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(timeline.statusCode).toBe(200);
    expect(timeline.json()).toMatchObject({
      trip: { id: tripId, state: 'REQUESTED', version: 0 },
      transitions: [
        {
          command: 'CREATE_TRIP',
          fromState: null,
          toState: 'REQUESTED',
          toVersion: 0,
        },
      ],
      diagnosticAudits: [],
    });
    expect(JSON.stringify(timeline.json())).not.toContain('Demo pickup');
    expect(JSON.stringify(timeline.json())).not.toContain(customer.email);
    expect(JSON.stringify(timeline.json())).not.toContain(customer.userId);

    const missingReason = await server.inject({
      method: 'POST',
      url: `/api/v1/operator/trips/${tripId}/diagnostic-reviews`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {},
    });
    expect(missingReason.statusCode).toBe(400);
    expect(missingReason.json().code).toBe('VALIDATION_FAILED');

    const review = await server.inject({
      method: 'POST',
      url: `/api/v1/operator/trips/${tripId}/diagnostic-reviews`,
      headers: {
        authorization: `Bearer ${operatorToken}`,
        'x-correlation-id': 'operator-review-test',
      },
      payload: { reason: 'Confirm the initial Trip diagnostic timeline.' },
    });
    expect(review.statusCode).toBe(201);
    expect(review.json()).toMatchObject({
      action: 'DIAGNOSTIC_REVIEW',
      reason: 'Confirm the initial Trip diagnostic timeline.',
      correlationId: 'operator-review-test',
    });

    const invalidCorrelation = await server.inject({
      method: 'POST',
      url: `/api/v1/operator/trips/${tripId}/diagnostic-reviews`,
      headers: {
        authorization: `Bearer ${operatorToken}`,
        'x-correlation-id': 'x'.repeat(129),
      },
      payload: { reason: 'Reject an invalid correlation ID.' },
    });
    expect(invalidCorrelation.statusCode).toBe(400);
    expect(invalidCorrelation.json().code).toBe('CORRELATION_ID_INVALID');

    const durableAudit = await database.query<{
      operator_user_id: string;
      reason: string;
      correlation_id: string;
    }>(
      `SELECT operator_user_id, reason, correlation_id
       FROM audit.operator_diagnostic_actions
       WHERE id = $1`,
      [review.json().id],
    );
    expect(durableAudit.rows).toEqual([
      {
        operator_user_id: customer.userId,
        reason: 'Confirm the initial Trip diagnostic timeline.',
        correlation_id: 'operator-review-test',
      },
    ]);

    const updatedTimeline = await server.inject({
      method: 'GET',
      url: `/api/v1/operator/trips/${tripId}/timeline`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(updatedTimeline.statusCode).toBe(200);
    expect(updatedTimeline.json().diagnosticAudits).toHaveLength(1);
    expect(updatedTimeline.json().diagnosticAudits[0]).toMatchObject({
      id: review.json().id,
      action: 'DIAGNOSTIC_REVIEW',
      correlationId: 'operator-review-test',
    });
    expect(JSON.stringify(updatedTimeline.json())).not.toContain(
      'Confirm the initial Trip diagnostic timeline.',
    );
  });

  it('allows only an Operator to approve a complete Driver profile and Vehicle', async () => {
    const driver = await registerDriver();
    const vehicle = await server.inject({
      method: 'POST',
      url: '/api/v1/drivers/me/vehicles',
      headers: { authorization: `Bearer ${driver.accessToken}` },
      payload: {
        vehicleClass: 'MOTORBIKE',
        make: 'Honda',
        model: 'Winner',
        modelYear: 2024,
        plate: `51A-${randomUUID().slice(0, 6)}`,
      },
    });
    expect(vehicle.statusCode).toBe(201);
    const vehicleId = vehicle.json().id as string;

    const operator = await registerCustomer();
    const forbidden = await server.inject({
      method: 'POST',
      url: `/api/v1/operator/drivers/${driver.userId}/approve`,
      headers: {
        authorization: `Bearer ${operator.accessToken}`,
        'content-type': 'application/json',
      },
      payload: { reason: 'This actor is not an Operator.' },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().code).toBe('AUTH_FORBIDDEN');

    await database.query(
      `INSERT INTO identity.user_roles (user_id, role_code)
       VALUES ($1, 'OPERATOR')`,
      [operator.userId],
    );
    const operatorToken = await login(operator.email);

    const approvedDriver = await server.inject({
      method: 'POST',
      url: `/api/v1/operator/drivers/${driver.userId}/approve`,
      headers: {
        authorization: `Bearer ${operatorToken}`,
        'idempotency-key': 'approve-driver-1',
      },
      payload: { reason: 'Profile documents verified.' },
    });
    expect(approvedDriver.statusCode).toBe(201);
    expect(approvedDriver.json()).toMatchObject({
      subjectType: 'DRIVER_PROFILE',
      driverUserId: driver.userId,
      previousStatus: 'PENDING',
      resultingStatus: 'APPROVED',
      reason: 'Profile documents verified.',
      reviewedByUserId: operator.userId,
    });

    const approvedVehicle = await server.inject({
      method: 'POST',
      url: `/api/v1/operator/drivers/${driver.userId}/vehicles/${vehicleId}/approve`,
      headers: {
        authorization: `Bearer ${operatorToken}`,
        'idempotency-key': 'approve-vehicle-1',
      },
      payload: { reason: 'Vehicle documents verified.' },
    });
    expect(approvedVehicle.statusCode).toBe(201);
    expect(approvedVehicle.json()).toMatchObject({
      subjectType: 'VEHICLE',
      driverUserId: driver.userId,
      vehicleId,
      previousStatus: 'PENDING',
      resultingStatus: 'APPROVED',
      reason: 'Vehicle documents verified.',
      reviewedByUserId: operator.userId,
    });

    const state = await database.query<{
      profile_status: string;
      vehicle_status: string;
      is_selected: boolean;
    }>(
      `SELECT p.approval_status AS profile_status,
              v.approval_status AS vehicle_status,
              v.is_selected
       FROM driver.driver_profiles p
       JOIN driver.vehicles v ON v.driver_user_id = p.user_id
       WHERE p.user_id = $1 AND v.id = $2`,
      [driver.userId, vehicleId],
    );
    expect(state.rows).toEqual([
      {
        profile_status: 'APPROVED',
        vehicle_status: 'APPROVED',
        is_selected: true,
      },
    ]);
  });

  it('allows an Operator to reject a pending Driver profile and persists its audit', async () => {
    const driver = await registerDriver();
    const customer = await registerCustomer();

    const forbidden = await server.inject({
      method: 'POST',
      url: `/api/v1/operator/drivers/${driver.userId}/reject`,
      headers: { authorization: `Bearer ${customer.accessToken}` },
      payload: { reason: 'Customer must not review onboarding.' },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().code).toBe('AUTH_FORBIDDEN');

    await database.query(
      `INSERT INTO identity.user_roles (user_id, role_code)
       VALUES ($1, 'OPERATOR')`,
      [customer.userId],
    );
    const operatorToken = await login(customer.email);

    const invalidReason = await server.inject({
      method: 'POST',
      url: `/api/v1/operator/drivers/${driver.userId}/reject`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { reason: 'x' },
    });
    expect(invalidReason.statusCode).toBe(400);
    expect(invalidReason.json().code).toBe('VALIDATION_FAILED');

    const missingKey = await server.inject({
      method: 'POST',
      url: `/api/v1/operator/drivers/${driver.userId}/reject`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { reason: 'A valid idempotency key is required.' },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json().code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const rejected = await server.inject({
      method: 'POST',
      url: `/api/v1/operator/drivers/${driver.userId}/reject`,
      headers: {
        authorization: `Bearer ${operatorToken}`,
        'idempotency-key': 'reject-driver-1',
      },
      payload: { reason: 'Driver documents could not be verified.' },
    });
    expect(rejected.statusCode).toBe(201);
    expect(rejected.json()).toMatchObject({
      subjectType: 'DRIVER_PROFILE',
      driverUserId: driver.userId,
      previousStatus: 'PENDING',
      resultingStatus: 'REJECTED',
      reason: 'Driver documents could not be verified.',
      reviewedByUserId: customer.userId,
    });

    const replay = await server.inject({
      method: 'POST',
      url: `/api/v1/operator/drivers/${driver.userId}/reject`,
      headers: {
        authorization: `Bearer ${operatorToken}`,
        'idempotency-key': 'reject-driver-1',
      },
      payload: { reason: 'Driver documents could not be verified.' },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(rejected.json());

    const reused = await server.inject({
      method: 'POST',
      url: `/api/v1/operator/drivers/${driver.userId}/reject`,
      headers: {
        authorization: `Bearer ${operatorToken}`,
        'idempotency-key': 'reject-driver-1',
      },
      payload: { reason: 'A different reason must not reuse the key.' },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().code).toBe('IDEMPOTENCY_KEY_REUSED');

    const persisted = await database.query<{
      approval_status: string;
      review_reason: string;
      reviewed_by_user_id: string;
    }>(
      `SELECT approval_status, review_reason, reviewed_by_user_id
       FROM driver.driver_profiles
       WHERE user_id = $1`,
      [driver.userId],
    );
    expect(persisted.rows).toEqual([
      {
        approval_status: 'REJECTED',
        review_reason: 'Driver documents could not be verified.',
        reviewed_by_user_id: customer.userId,
      },
    ]);

    const audit = await database.query<{
      subject_type: string;
      resulting_status: string;
      reason: string;
      operator_user_id: string;
    }>(
      `SELECT subject_type, resulting_status, reason, operator_user_id
       FROM driver.onboarding_approval_actions
       WHERE id = $1`,
      [rejected.json().id],
    );
    expect(audit.rows).toEqual([
      {
        subject_type: 'DRIVER_PROFILE',
        resulting_status: 'REJECTED',
        reason: 'Driver documents could not be verified.',
        operator_user_id: customer.userId,
      },
    ]);

    const secondReview = await server.inject({
      method: 'POST',
      url: `/api/v1/operator/drivers/${driver.userId}/reject`,
      headers: {
        authorization: `Bearer ${operatorToken}`,
        'idempotency-key': 'reject-driver-2',
      },
      payload: { reason: 'A second review must be rejected.' },
    });
    expect(secondReview.statusCode).toBe(409);
    expect(secondReview.json().code).toBe('ONBOARDING_SUBJECT_NOT_PENDING');
  });

  it('rejects a pending Vehicle only for its owner Driver and clears selection', async () => {
    const driver = await registerDriver();
    const otherDriver = await registerDriver();
    const vehicle = await server.inject({
      method: 'POST',
      url: '/api/v1/drivers/me/vehicles',
      headers: { authorization: `Bearer ${driver.accessToken}` },
      payload: {
        vehicleClass: 'MOTORBIKE',
        make: 'Honda',
        model: 'Winner',
        modelYear: 2024,
        plate: `51A-${randomUUID().slice(0, 6)}`,
      },
    });
    expect(vehicle.statusCode).toBe(201);
    const vehicleId = vehicle.json().id as string;
    const operator = await registerCustomer();
    await database.query(
      `INSERT INTO identity.user_roles (user_id, role_code)
       VALUES ($1, 'OPERATOR')`,
      [operator.userId],
    );
    const operatorToken = await login(operator.email);

    const wrongOwner = await server.inject({
      method: 'POST',
      url: `/api/v1/operator/drivers/${otherDriver.userId}/vehicles/${vehicleId}/reject`,
      headers: {
        authorization: `Bearer ${operatorToken}`,
        'idempotency-key': 'reject-vehicle-wrong-owner',
      },
      payload: { reason: 'Ownership must be checked.' },
    });
    expect(wrongOwner.statusCode).toBe(404);
    expect(wrongOwner.json().code).toBe('VEHICLE_NOT_FOUND');

    const rejected = await server.inject({
      method: 'POST',
      url: `/api/v1/operator/drivers/${driver.userId}/vehicles/${vehicleId}/reject`,
      headers: {
        authorization: `Bearer ${operatorToken}`,
        'idempotency-key': 'reject-vehicle-1',
      },
      payload: { reason: 'Vehicle documents are incomplete.' },
    });
    expect(rejected.statusCode).toBe(201);
    expect(rejected.json()).toMatchObject({
      subjectType: 'VEHICLE',
      driverUserId: driver.userId,
      vehicleId,
      previousStatus: 'PENDING',
      resultingStatus: 'REJECTED',
    });

    const state = await database.query<{
      approval_status: string;
      is_selected: boolean;
      review_reason: string;
    }>(
      `SELECT approval_status, is_selected, review_reason
       FROM driver.vehicles
       WHERE id = $1 AND driver_user_id = $2`,
      [vehicleId, driver.userId],
    );
    expect(state.rows).toEqual([
      {
        approval_status: 'REJECTED',
        is_selected: false,
        review_reason: 'Vehicle documents are incomplete.',
      },
    ]);

    const audit = await database.query<{
      subject_type: string;
      vehicle_id: string;
      resulting_status: string;
    }>(
      `SELECT subject_type, vehicle_id, resulting_status
       FROM driver.onboarding_approval_actions
       WHERE id = $1`,
      [rejected.json().id],
    );
    expect(audit.rows).toEqual([
      {
        subject_type: 'VEHICLE',
        vehicle_id: vehicleId,
        resulting_status: 'REJECTED',
      },
    ]);
  });

  async function registerCustomer(): Promise<{
    accessToken: string;
    email: string;
    userId: string;
  }> {
    const email = `operator.audit.${randomUUID()}@gove.test`;
    const registration = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'idempotency-key': randomUUID() },
      payload: {
        email,
        displayName: 'Diagnostic Customer',
        password,
        requestedRole: 'CUSTOMER',
      },
    });
    expect(registration.statusCode).toBe(201);
    return {
      accessToken: await login(email),
      email,
      userId: registration.json().actor.id,
    };
  }

  async function registerDriver(): Promise<{
    accessToken: string;
    userId: string;
  }> {
    const email = `operator.driver.${randomUUID()}@gove.test`;
    const registration = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'idempotency-key': randomUUID() },
      payload: {
        email,
        displayName: 'Approval Driver',
        password,
        requestedRole: 'DRIVER',
      },
    });
    expect(registration.statusCode).toBe(201);
    const accessToken = await login(email);
    const profile = await server.inject({
      method: 'PUT',
      url: '/api/v1/drivers/me/profile',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { phone: '0901234567' },
    });
    expect(profile.statusCode).toBe(200);
    return { accessToken, userId: registration.json().actor.id as string };
  }

  async function login(email: string): Promise<string> {
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    return login.json().accessToken as string;
  }

  async function createTrip(accessToken: string): Promise<string> {
    const quote = await server.inject({
      method: 'POST',
      url: '/api/v1/pricing/fare-quotes',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': randomUUID(),
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
});
