import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../main.js';
import { DatabaseService } from '../database/database.service.js';
import { DispatchExpiryWorker } from './dispatch-expiry.worker.js';

describe('Dispatch HTTP seam', () => {
  let app: Awaited<ReturnType<typeof createApplication>>;
  let server: FastifyInstance;
  let database: DatabaseService;
  const password = 'correct horse battery staple';

  beforeAll(async () => {
    app = await createApplication();
    await app.init();
    // These integration tests invoke the expiry sweep deterministically via
    // runOnce(); prevent the background interval from racing the fixtures.
    app.get(DispatchExpiryWorker).onModuleDestroy();
    server = app.getHttpAdapter().getInstance();
    database = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('offers one fresh eligible Driver and commits one concurrent acceptance', async () => {
    const customer = await registerAndLogin('CUSTOMER', 'Dispatch Customer');
    const driver = await registerAndLogin('DRIVER', 'Dispatch Driver');
    await setAllAvailableDriversOffline();
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

    const pendingOffers = await server.inject({
      method: 'GET',
      url: '/api/v1/dispatch/offers/me',
      headers: { authorization: `Bearer ${driver.accessToken}` },
    });
    expect(pendingOffers.statusCode).toBe(200);
    expect(pendingOffers.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ tripId })]),
    );
    const noCurrentTrip = await server.inject({
      method: 'GET',
      url: '/api/v1/dispatch/trips/current',
      headers: { authorization: `Bearer ${driver.accessToken}` },
    });
    expect(noCurrentTrip.statusCode).toBe(200);
    expect(noCurrentTrip.json()).toBeNull();

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

    const currentTrip = await server.inject({
      method: 'GET',
      url: '/api/v1/dispatch/trips/current',
      headers: { authorization: `Bearer ${driver.accessToken}` },
    });
    expect(currentTrip.statusCode).toBe(200);
    expect(currentTrip.json()).toMatchObject({
      id: tripId,
      state: 'DRIVER_TO_PICKUP',
      driverId: driver.actorId,
      pickup: {
        latitude: 21.0285,
        longitude: 105.8048,
      },
      dropoff: {
        latitude: 21.033,
        longitude: 105.835,
      },
    });

    const currentWorkState = await server.inject({
      method: 'GET',
      url: '/api/v1/drivers/me/work-state',
      headers: { authorization: `Bearer ${driver.accessToken}` },
    });
    expect(currentWorkState.statusCode).toBe(200);
    expect(currentWorkState.json()).toMatchObject({
      driverId: driver.actorId,
      state: 'TO_PICKUP',
    });
  });

  it('replays the original acceptance response after the Trip advances', async () => {
    const customer = await registerAndLogin(
      'CUSTOMER',
      'Acceptance Replay Customer',
    );
    const driver = await registerAndLogin('DRIVER', 'Acceptance Replay Driver');
    await setAllAvailableDriversOffline();
    await approveDriver(driver.actorId, 'dispatch-acceptance-replay');
    await sendLocationAndGoOnline(driver.accessToken);

    const tripId = await createRequestedTrip(customer.accessToken);
    const matching = await startMatching(customer.accessToken, tripId);
    const offerId = matching.json().offer.id as string;
    const acceptanceKey = randomUUID();
    const accepted = await acceptOffer(
      driver.accessToken,
      offerId,
      acceptanceKey,
    );
    expect(accepted.statusCode).toBe(201);

    const arrived = await transitionTrip(
      driver.accessToken,
      tripId,
      'arrive',
      randomUUID(),
    );
    expect(arrived.statusCode).toBe(201);

    const replay = await acceptOffer(
      driver.accessToken,
      offerId,
      acceptanceKey,
    );
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(accepted.json());
  });

  it('expires an offer atomically and releases the Driver reservation', async () => {
    const customer = await registerAndLogin('CUSTOMER', 'Expiry Customer');
    const driver = await registerAndLogin('DRIVER', 'Expiry Driver');
    await setAllAvailableDriversOffline();
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

  it('sweeps an expired Offer once and closes matching when no replacement exists', async () => {
    const customer = await registerAndLogin(
      'CUSTOMER',
      'Expiry Worker Customer',
    );
    const driver = await registerAndLogin('DRIVER', 'Expiry Worker Driver');
    await setAllAvailableDriversOffline();
    await database.query(
      `UPDATE dispatch.trip_offers
       SET expires_at = greatest(expires_at, now() + INTERVAL '1 hour')
       WHERE status = 'PENDING'`,
    );
    await approveDriver(driver.actorId, 'dispatch-expiry-worker');
    await sendLocationAndGoOnline(driver.accessToken);

    const tripId = await createRequestedTrip(customer.accessToken);
    const matching = await startMatching(customer.accessToken, tripId);
    const offerId = matching.json().offer.id as string;
    await database.query(
      `UPDATE dispatch.trip_offers
       SET offered_at = now() - INTERVAL '1 minute',
           expires_at = now() - INTERVAL '1 second'
       WHERE id = $1`,
      [offerId],
    );

    const worker = app.get(DispatchExpiryWorker);
    expect(await worker.runOnce()).toBe(1);
    expect(await worker.runOnce()).toBe(0);

    const state = await database.query<{
      offer_status: string;
      reservation_status: string;
      work_state: string;
      trip_state: string;
    }>(
      `SELECT o.status AS offer_status,
              r.status AS reservation_status,
              ws.work_state,
              t.state AS trip_state
       FROM dispatch.trip_offers o
       JOIN dispatch.driver_reservations r ON r.id = o.reservation_id
       JOIN dispatch.driver_work_states ws ON ws.driver_user_id = o.driver_user_id
       JOIN trip.trips t ON t.id = o.trip_id
       WHERE o.id = $1`,
      [offerId],
    );
    expect(state.rows[0]).toMatchObject({
      offer_status: 'EXPIRED',
      reservation_status: 'EXPIRED',
      work_state: 'AVAILABLE',
      trip_state: 'NO_DRIVER_AVAILABLE',
    });
  });

  it('releases a due Offer without reopening a terminal Trip', async () => {
    const customer = await registerAndLogin(
      'CUSTOMER',
      'Terminal Expiry Customer',
    );
    const driver = await registerAndLogin('DRIVER', 'Terminal Expiry Driver');
    await setAllAvailableDriversOffline();
    await approveDriver(driver.actorId, 'dispatch-terminal-expiry');
    await sendLocationAndGoOnline(driver.accessToken);

    const tripId = await createRequestedTrip(customer.accessToken);
    const matching = await startMatching(customer.accessToken, tripId);
    expect(matching.statusCode).toBe(201);
    const offerId = matching.json().offer.id as string;

    // Simulate a recovered terminal Trip whose pending Offer was not swept
    // before the terminal state became durable.
    await database.query(
      `UPDATE trip.trips SET state = 'CANCELLED', updated_at = now()
       WHERE id = $1`,
      [tripId],
    );
    await database.query(
      `UPDATE dispatch.trip_offers
       SET offered_at = now() - INTERVAL '1 minute',
           expires_at = now() - INTERVAL '1 second'
       WHERE id = $1`,
      [offerId],
    );

    const worker = app.get(DispatchExpiryWorker);
    expect(await worker.runOnce()).toBe(1);

    const state = await database.query<{
      trip_state: string;
      offer_status: string;
      reservation_status: string;
      work_state: string;
      expired_events: string;
    }>(
      `SELECT t.state AS trip_state,
              o.status AS offer_status,
              r.status AS reservation_status,
              ws.work_state,
              (SELECT count(*)::text FROM trip.outbox_events
               WHERE trip_id = t.id AND event_type = 'dispatch.offer.expired') AS expired_events
       FROM trip.trips t
       JOIN dispatch.trip_offers o ON o.trip_id = t.id
       JOIN dispatch.driver_reservations r ON r.id = o.reservation_id
       JOIN dispatch.driver_work_states ws ON ws.driver_user_id = o.driver_user_id
       WHERE t.id = $1 AND o.id = $2`,
      [tripId, offerId],
    );
    expect(state.rows[0]).toEqual({
      trip_state: 'CANCELLED',
      offer_status: 'EXPIRED',
      reservation_status: 'EXPIRED',
      work_state: 'AVAILABLE',
      expired_events: '1',
    });
  });

  it('skips a stale unmatchable Offer without preventing another due Offer from expiring', async () => {
    const firstCustomer = await registerAndLogin(
      'CUSTOMER',
      'Stale Expiry First Customer',
    );
    const secondCustomer = await registerAndLogin(
      'CUSTOMER',
      'Stale Expiry Second Customer',
    );
    const firstDriver = await registerAndLogin(
      'DRIVER',
      'Stale Expiry First Driver',
    );
    const secondDriver = await registerAndLogin(
      'DRIVER',
      'Stale Expiry Second Driver',
    );
    await setAllAvailableDriversOffline();
    await approveDriver(firstDriver.actorId, 'stale-expiry-first');
    await approveDriver(secondDriver.actorId, 'stale-expiry-second');
    await sendLocationAndGoOnline(firstDriver.accessToken);
    await sendLocationAndGoOnline(secondDriver.accessToken);

    const firstTripId = await createRequestedTrip(firstCustomer.accessToken);
    const firstMatch = await startMatching(
      firstCustomer.accessToken,
      firstTripId,
    );
    const secondTripId = await createRequestedTrip(secondCustomer.accessToken);
    const secondMatch = await startMatching(
      secondCustomer.accessToken,
      secondTripId,
    );
    const firstOfferId = firstMatch.json().offer.id as string;
    const secondOfferId = secondMatch.json().offer.id as string;

    await database.query(
      `UPDATE dispatch.trip_offers
       SET offered_at = now() - INTERVAL '1 minute',
           expires_at = now() - INTERVAL '1 second'
       WHERE id IN ($1, $2)`,
      [firstOfferId, secondOfferId],
    );
    // This shape is stale recovery data: a committed reservation and a Driver
    // already en route must never cause expiry to mutate only the Offer or
    // allocate another Driver. It requires explicit reconciliation, while
    // the rest of the batch must still make progress.
    await database.query(
      `UPDATE dispatch.driver_reservations
       SET status = 'COMMITTED', resolved_at = now(),
           resolution_reason = 'RECOVERY_COMMITTED'
       WHERE id = (SELECT reservation_id FROM dispatch.trip_offers WHERE id = $1)`,
      [firstOfferId],
    );
    await database.query(
      `UPDATE dispatch.driver_work_states
       SET work_state = 'TO_PICKUP', current_trip_id = $2,
           state_version = state_version + 1,
           state_changed_at = now(), updated_at = now()
       WHERE driver_user_id = (
         SELECT driver_user_id FROM dispatch.trip_offers WHERE id = $1
       )`,
      [firstOfferId, firstTripId],
    );

    const worker = app.get(DispatchExpiryWorker);
    expect(await worker.runOnce()).toBe(1);

    const stale = await database.query<{
      offer_status: string;
      reservation_status: string;
      work_state: string;
      trip_state: string;
      expired_events: string;
    }>(
      `SELECT o.status AS offer_status,
              r.status AS reservation_status,
              ws.work_state,
              t.state AS trip_state,
              (SELECT count(*)::text FROM trip.outbox_events
               WHERE trip_id = t.id
                 AND event_type = 'dispatch.offer.expired') AS expired_events
       FROM dispatch.trip_offers o
       JOIN dispatch.driver_reservations r ON r.id = o.reservation_id
       JOIN dispatch.driver_work_states ws ON ws.driver_user_id = o.driver_user_id
       JOIN trip.trips t ON t.id = o.trip_id
       WHERE o.id = $1`,
      [firstOfferId],
    );
    expect(stale.rows[0]).toEqual({
      offer_status: 'PENDING',
      reservation_status: 'COMMITTED',
      work_state: 'TO_PICKUP',
      trip_state: 'MATCHING',
      expired_events: '0',
    });

    const validOffer = await database.query<{
      offer_status: string;
      trip_state: string;
    }>(
      `SELECT o.status AS offer_status, t.state AS trip_state
       FROM dispatch.trip_offers o
       JOIN trip.trips t ON t.id = o.trip_id
       WHERE o.id = $1`,
      [secondOfferId],
    );
    expect(validOffer.rows[0]).toEqual({
      offer_status: 'EXPIRED',
      trip_state: 'NO_DRIVER_AVAILABLE',
    });
  });

  it('records each expiry across successive reassignment attempts', async () => {
    const customer = await registerAndLogin(
      'CUSTOMER',
      'Repeated Expiry Customer',
    );
    const drivers = await Promise.all(
      ['One', 'Two', 'Three'].map(async (suffix) => {
        const driver = await registerAndLogin(
          'DRIVER',
          `Repeated Expiry Driver ${suffix}`,
        );
        await approveDriver(
          driver.actorId,
          `dispatch-repeated-expiry-${suffix}`,
        );
        await sendLocationAndGoOnline(driver.accessToken);
        return driver;
      }),
    );
    await setAllAvailableDriversOffline();
    await waitForLocationWindow();
    for (const driver of drivers) {
      await sendLocationAndGoOnline(driver.accessToken);
    }

    const tripId = await createRequestedTrip(customer.accessToken);
    const firstMatch = await startMatching(customer.accessToken, tripId);
    expect(firstMatch.statusCode).toBe(201);

    await database.query(
      `UPDATE dispatch.trip_offers
       SET offered_at = now() - INTERVAL '1 minute',
           expires_at = now() - INTERVAL '1 second'
       WHERE trip_id = $1 AND status = 'PENDING'`,
      [tripId],
    );
    await database.query(
      `UPDATE dispatch.trip_offers
       SET expires_at = greatest(expires_at, now() + INTERVAL '1 hour')
       WHERE trip_id <> $1 AND status = 'PENDING'`,
      [tripId],
    );

    const worker = app.get(DispatchExpiryWorker);
    expect(await worker.runOnce()).toBe(1);

    const secondOffer = await database.query<{ id: string }>(
      `SELECT id FROM dispatch.trip_offers
       WHERE trip_id = $1 AND status = 'PENDING'
       ORDER BY attempt_number DESC
       LIMIT 1`,
      [tripId],
    );
    expect(secondOffer.rows[0]).toBeDefined();
    await database.query(
      `UPDATE dispatch.trip_offers
       SET offered_at = now() - INTERVAL '1 minute',
           expires_at = now() - INTERVAL '1 second'
       WHERE id = $1`,
      [secondOffer.rows[0]?.id],
    );

    expect(await worker.runOnce()).toBe(1);

    const outboxEvents = await database.query<{
      event_type: string;
      count: string;
    }>(
      `SELECT event_type, count(*)::text AS count
       FROM trip.outbox_events
       WHERE trip_id = $1 AND event_type = 'dispatch.offer.expired'
       GROUP BY event_type`,
      [tripId],
    );
    expect(outboxEvents.rows[0]).toEqual({
      event_type: 'dispatch.offer.expired',
      count: '2',
    });
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

  it('rejects an Offer, releases the Driver, and assigns one bounded replacement', async () => {
    const customer = await registerAndLogin('CUSTOMER', 'Reject Customer');
    const firstDriver = await registerAndLogin('DRIVER', 'Reject First Driver');
    const secondDriver = await registerAndLogin(
      'DRIVER',
      'Reject Second Driver',
    );
    await setAllAvailableDriversOffline();
    await approveDriver(firstDriver.actorId, 'dispatch-reject-first');
    await approveDriver(secondDriver.actorId, 'dispatch-reject-second');
    await sendLocationAndGoOnline(firstDriver.accessToken);
    await sendLocationAndGoOnline(secondDriver.accessToken);

    const tripId = await createRequestedTrip(customer.accessToken);
    const matching = await startMatching(customer.accessToken, tripId);
    const offeredDriverId = matching.json().offer.driverId as string;
    const offeredDriver =
      offeredDriverId === firstDriver.actorId ? firstDriver : secondDriver;
    const replacementDriver =
      offeredDriverId === firstDriver.actorId ? secondDriver : firstDriver;
    const offerId = matching.json().offer.id as string;

    const rejection = await rejectOffer(
      offeredDriver.accessToken,
      offerId,
      randomUUID(),
    );

    expect(rejection.statusCode).toBe(201);
    expect(rejection.json()).toMatchObject({
      rejectedOffer: {
        id: offerId,
        status: 'REJECTED',
        tripState: 'MATCHING',
        tripVersion: 2,
      },
      reassignedOffer: {
        tripId,
        status: 'PENDING',
        attemptNumber: 2,
        driverId: replacementDriver.actorId,
        tripState: 'MATCHING',
        tripVersion: 2,
      },
    });

    const dispatchState = await database.query<{
      offer_status: string;
      reservation_status: string;
      work_state: string;
      current_trip_id: string | null;
    }>(
      `SELECT o.status AS offer_status,
              r.status AS reservation_status,
              ws.work_state,
              ws.current_trip_id
       FROM dispatch.trip_offers o
       JOIN dispatch.driver_reservations r ON r.id = o.reservation_id
       JOIN dispatch.driver_work_states ws ON ws.driver_user_id = o.driver_user_id
       WHERE o.id = $1`,
      [offerId],
    );
    expect(dispatchState.rows[0]).toMatchObject({
      offer_status: 'REJECTED',
      reservation_status: 'RELEASED',
      work_state: 'AVAILABLE',
      current_trip_id: null,
    });
  });

  it('replays a duplicate reject and does not create another Offer', async () => {
    const customer = await registerAndLogin(
      'CUSTOMER',
      'Duplicate Reject Customer',
    );
    const driver = await registerAndLogin('DRIVER', 'Duplicate Reject Driver');
    await setAllAvailableDriversOffline();
    await approveDriver(driver.actorId, 'dispatch-reject-duplicate');
    await sendLocationAndGoOnline(driver.accessToken);

    const tripId = await createRequestedTrip(customer.accessToken);
    const matching = await startMatching(customer.accessToken, tripId);
    const offerId = matching.json().offer.id as string;
    const rejectKey = randomUUID();
    const [first, retry] = await Promise.all([
      rejectOffer(driver.accessToken, offerId, rejectKey),
      rejectOffer(driver.accessToken, offerId, rejectKey),
    ]);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(first.json()).toMatchObject({
      rejectedOffer: {
        id: offerId,
        status: 'REJECTED',
        tripState: 'NO_DRIVER_AVAILABLE',
        tripVersion: 3,
      },
      reassignedOffer: null,
    });

    const offers = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM dispatch.trip_offers WHERE trip_id = $1`,
      [tripId],
    );
    expect(offers.rows[0]?.count).toBe('1');
  });

  it('does not accept a rejected Offer', async () => {
    const customer = await registerAndLogin(
      'CUSTOMER',
      'Rejected Acceptance Customer',
    );
    const driver = await registerAndLogin(
      'DRIVER',
      'Rejected Acceptance Driver',
    );
    await setAllAvailableDriversOffline();
    await approveDriver(driver.actorId, 'dispatch-rejected-acceptance');
    await sendLocationAndGoOnline(driver.accessToken);

    const tripId = await createRequestedTrip(customer.accessToken);
    const matching = await startMatching(customer.accessToken, tripId);
    const offerId = matching.json().offer.id as string;
    const rejection = await rejectOffer(
      driver.accessToken,
      offerId,
      randomUUID(),
    );
    expect(rejection.statusCode).toBe(201);

    const acceptance = await acceptOffer(
      driver.accessToken,
      offerId,
      randomUUID(),
    );
    expect(acceptance.statusCode).toBe(409);
    expect(acceptance.json()).toMatchObject({
      code: 'OFFER_ALREADY_RESOLVED',
    });
  });

  it('drives an accepted Trip through Pickup, start, completion, and final Fare', async () => {
    const customer = await registerAndLogin('CUSTOMER', 'Completion Customer');
    const driver = await registerAndLogin('DRIVER', 'Completion Driver');
    await setAllAvailableDriversOffline();
    await approveDriver(driver.actorId, 'completion');
    await sendLocationAndGoOnline(driver.accessToken);

    const tripId = await createRequestedTrip(customer.accessToken);
    const matching = await startMatching(customer.accessToken, tripId);
    const offerId = matching.json().offer.id as string;
    const accepted = await acceptOffer(
      driver.accessToken,
      offerId,
      randomUUID(),
    );
    expect(accepted.statusCode).toBe(201);

    const arrived = await transitionTrip(
      driver.accessToken,
      tripId,
      'arrive',
      randomUUID(),
    );
    expect(arrived.statusCode).toBe(201);
    expect(arrived.json()).toMatchObject({
      id: tripId,
      state: 'AT_PICKUP',
      version: 3,
      driverId: driver.actorId,
      finalFareMinor: null,
    });

    const started = await transitionTrip(
      driver.accessToken,
      tripId,
      'start',
      randomUUID(),
    );
    expect(started.statusCode).toBe(201);
    expect(started.json()).toMatchObject({
      id: tripId,
      state: 'IN_PROGRESS',
      version: 4,
    });

    const completeKey = randomUUID();
    const [completed, replayed] = await Promise.all([
      completeTrip(driver.accessToken, tripId, completeKey),
      completeTrip(driver.accessToken, tripId, completeKey),
    ]);
    expect(completed.statusCode).toBe(201);
    expect(replayed.statusCode).toBe(201);
    expect(replayed.json()).toEqual(completed.json());
    expect(completed.json()).toMatchObject({
      id: tripId,
      state: 'COMPLETED',
      version: 5,
      actualDistanceMeters: 2_500,
      actualDurationSeconds: 420,
      finalFareMinor: 31_450,
    });

    const durableState = await database.query<{
      assignment_status: string;
      work_state: string;
      final_fare_minor: string;
      transition_count: string;
    }>(
      `SELECT a.status AS assignment_status,
              ws.work_state,
              t.final_fare_minor,
              (SELECT count(*)::text FROM trip.state_transitions WHERE trip_id = t.id) AS transition_count
       FROM trip.trips t
       JOIN dispatch.assignments a ON a.trip_id = t.id
       JOIN dispatch.driver_work_states ws ON ws.driver_user_id = a.driver_user_id
       WHERE t.id = $1`,
      [tripId],
    );
    expect(durableState.rows[0]).toMatchObject({
      assignment_status: 'COMPLETED',
      work_state: 'AVAILABLE',
      final_fare_minor: '31450',
      transition_count: '6',
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
           state_version = state_version + 1,
           state_changed_at = now(), updated_at = now()
       WHERE work_state = 'AVAILABLE'`,
    );
  }

  async function waitForLocationWindow(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 3_050));
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
          latitude: 21.0285,
          longitude: 105.8048,
        },
        dropoff: {
          label: 'Dispatch dropoff',
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

  function rejectOffer(
    accessToken: string,
    offerId: string,
    idempotencyKey: string,
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/dispatch/offers/${offerId}/reject`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': idempotencyKey,
      },
    });
  }

  function transitionTrip(
    accessToken: string,
    tripId: string,
    action: 'arrive' | 'start',
    idempotencyKey: string,
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/dispatch/trips/${tripId}/${action}`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': idempotencyKey,
      },
    });
  }

  function completeTrip(
    accessToken: string,
    tripId: string,
    idempotencyKey: string,
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/dispatch/trips/${tripId}/complete`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': idempotencyKey,
      },
      payload: { actualDistanceMeters: 2_500, actualDurationSeconds: 420 },
    });
  }
});
