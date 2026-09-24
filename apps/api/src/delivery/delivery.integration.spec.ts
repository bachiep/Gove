import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../main.js';
import { DatabaseService } from '../database/database.service.js';
import { DeliveryExpiryWorker } from './delivery-expiry.worker.js';

interface DeliveryPayload {
  pickup: { label: string; latitude: number; longitude: number };
  dropoff: { label: string; latitude: number; longitude: number };
  recipient: { displayName: string; contactPhone: string };
  parcel: { description: string; declaredWeightGrams: number };
}

describe('Delivery HTTP seam', () => {
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

  it('creates one idempotent requested Delivery without creating a Trip', async () => {
    const accessToken = await customerToken();
    const idempotencyKey = randomUUID();
    const payload = {
      pickup: {
        label: 'Parcel pickup',
        latitude: 10.76,
        longitude: 106.68,
      },
      dropoff: {
        label: 'Parcel dropoff',
        latitude: 10.78,
        longitude: 106.7,
      },
      recipient: {
        displayName: 'Delivery Recipient',
        contactPhone: '+84901234567',
      },
      parcel: {
        description: 'Book bundle',
        declaredWeightGrams: 1200,
      },
    };

    const [first, replay] = await Promise.all([
      createDelivery(accessToken, idempotencyKey, payload),
      createDelivery(accessToken, idempotencyKey, payload),
    ]);

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(first.json().id);
    expect(first.json()).toMatchObject({
      state: 'REQUESTED',
      version: 0,
      pickup: payload.pickup,
      dropoff: payload.dropoff,
      recipientDisplayName: payload.recipient.displayName,
      parcelDescription: payload.parcel.description,
      declaredWeightGrams: payload.parcel.declaredWeightGrams,
    });
  });

  it('returns a Delivery only to its Customer owner', async () => {
    const ownerToken = await customerToken();
    const created = await createDelivery(ownerToken, randomUUID(), {
      pickup: {
        label: 'Owner pickup',
        latitude: 10.76,
        longitude: 106.68,
      },
      dropoff: {
        label: 'Owner dropoff',
        latitude: 10.78,
        longitude: 106.7,
      },
      recipient: {
        displayName: 'Private Recipient',
        contactPhone: '+84901234567',
      },
      parcel: { description: 'Private parcel', declaredWeightGrams: 500 },
    });
    expect(created.statusCode).toBe(201);

    const ownerRead = await server.inject({
      method: 'GET',
      url: `/api/v1/deliveries/${created.json().id as string}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(ownerRead.statusCode).toBe(200);
    expect(ownerRead.json().recipientDisplayName).toBe('Private Recipient');

    const otherToken = await customerToken();
    const otherRead = await server.inject({
      method: 'GET',
      url: `/api/v1/deliveries/${created.json().id as string}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(otherRead.statusCode).toBe(404);
    expect(otherRead.json().code).toBe('DELIVERY_NOT_FOUND');
  });

  it('lists only Customer-owned Deliveries', async () => {
    const owner = await customerSession();
    const other = await customerSession();
    const created = await createDelivery(
      owner.accessToken,
      randomUUID(),
      deliveryPayload('History'),
    );
    expect(created.statusCode).toBe(201);
    const ownerList = await server.inject({
      method: 'GET',
      url: '/api/v1/deliveries',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(ownerList.statusCode).toBe(200);
    expect(ownerList.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.json().id }),
      ]),
    );
    const otherList = await server.inject({
      method: 'GET',
      url: '/api/v1/deliveries',
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    expect(otherList.statusCode).toBe(200);
    expect(otherList.json()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.json().id }),
      ]),
    );
  });

  it('reserves one Driver and commits concurrent acceptance for a Delivery', async () => {
    const customer = await customerSession();
    const driver = await driverSession();
    await setAllAvailableDriversOffline();
    await approveDriver(driver.actorId);
    await sendLocationAndGoOnline(driver.accessToken);
    const created = await createDelivery(customer.accessToken, randomUUID(), {
      pickup: { label: 'Dispatch pickup', latitude: 10.76, longitude: 106.68 },
      dropoff: { label: 'Dispatch dropoff', latitude: 10.78, longitude: 106.7 },
      recipient: {
        displayName: 'Dispatch Recipient',
        contactPhone: '+84901234567',
      },
      parcel: { description: 'Dispatch parcel', declaredWeightGrams: 900 },
    });
    expect(created.statusCode).toBe(201);
    const deliveryId = created.json().id as string;

    const matchingKey = randomUUID();
    const [matching, replay] = await Promise.all([
      startMatching(customer.accessToken, deliveryId, matchingKey),
      startMatching(customer.accessToken, deliveryId, matchingKey),
    ]);
    expect(matching.statusCode).toBe(201);
    expect(replay.json()).toEqual(matching.json());
    expect(matching.json()).toMatchObject({
      deliveryId,
      deliveryState: 'MATCHING',
      deliveryVersion: 1,
      offer: { driverId: driver.actorId, status: 'PENDING', attemptNumber: 1 },
    });

    const pendingOffers = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery-offers/me',
      headers: { authorization: `Bearer ${driver.accessToken}` },
    });
    expect(pendingOffers.statusCode).toBe(200);
    expect(pendingOffers.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ deliveryId })]),
    );

    const offerId = matching.json().offer.id as string;
    const acceptKey = randomUUID();
    const [accepted, acceptedReplay] = await Promise.all([
      acceptOffer(driver.accessToken, offerId, acceptKey),
      acceptOffer(driver.accessToken, offerId, acceptKey),
    ]);
    expect(accepted.statusCode).toBe(201);
    expect(acceptedReplay.json()).toEqual(accepted.json());
    expect(accepted.json()).toMatchObject({
      id: offerId,
      status: 'ACCEPTED',
      deliveryState: 'DRIVER_TO_PICKUP',
      deliveryVersion: 2,
    });

    const state = await database.query<{
      delivery_state: string;
      assignment_status: string;
      work_state: string;
      current_delivery_id: string;
      current_trip_id: string | null;
    }>(
      `SELECT d.state AS delivery_state, a.status AS assignment_status,
              ws.work_state, ws.current_delivery_id, ws.current_trip_id
       FROM delivery.deliveries d
       JOIN delivery.assignments a ON a.delivery_id = d.id
       JOIN dispatch.driver_work_states ws ON ws.driver_user_id = a.driver_user_id
       WHERE d.id = $1`,
      [deliveryId],
    );
    expect(state.rows[0]).toMatchObject({
      delivery_state: 'DRIVER_TO_PICKUP',
      assignment_status: 'ACTIVE',
      work_state: 'TO_PICKUP',
      current_delivery_id: deliveryId,
      current_trip_id: null,
    });

    const currentAssignment = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery-assignments/current',
      headers: { authorization: `Bearer ${driver.accessToken}` },
    });
    expect(currentAssignment.statusCode).toBe(200);
    expect(currentAssignment.json()).toMatchObject({
      id: deliveryId,
      state: 'DRIVER_TO_PICKUP',
    });
  });

  it('does not reserve one Driver for two concurrent Deliveries', async () => {
    const customer = await customerSession();
    const driver = await driverSession();
    await setAllAvailableDriversOffline();
    await approveDriver(driver.actorId);
    await sendLocationAndGoOnline(driver.accessToken);
    const [first, second] = await Promise.all([
      createDelivery(
        customer.accessToken,
        randomUUID(),
        deliveryPayload('First'),
      ),
      createDelivery(
        customer.accessToken,
        randomUUID(),
        deliveryPayload('Second'),
      ),
    ]);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const [firstMatch, secondMatch] = await Promise.all([
      startMatching(
        customer.accessToken,
        first.json().id as string,
        randomUUID(),
      ),
      startMatching(
        customer.accessToken,
        second.json().id as string,
        randomUUID(),
      ),
    ]);
    expect(firstMatch.statusCode).toBe(201);
    expect(secondMatch.statusCode).toBe(201);
    const matches = [firstMatch.json(), secondMatch.json()];
    expect(matches.filter((match) => match.offer !== null)).toHaveLength(1);
    expect(matches.filter((match) => match.offer === null)).toEqual([
      expect.objectContaining({ deliveryState: 'NO_DRIVER_AVAILABLE' }),
    ]);
  });

  it('expires a Delivery Offer and releases the Driver reservation', async () => {
    const customer = await customerSession();
    const driver = await driverSession();
    await setAllAvailableDriversOffline();
    await approveDriver(driver.actorId);
    await sendLocationAndGoOnline(driver.accessToken);
    const created = await createDelivery(
      customer.accessToken,
      randomUUID(),
      deliveryPayload('Expiry'),
    );
    const matching = await startMatching(
      customer.accessToken,
      created.json().id as string,
      randomUUID(),
    );
    expect(matching.statusCode).toBe(201);
    const offerId = matching.json().offer.id as string;
    await database.query(
      `UPDATE delivery.delivery_offers SET offered_at = now() - INTERVAL '1 minute', expires_at = now() - INTERVAL '1 second' WHERE id = $1`,
      [offerId],
    );
    await database.query(
      `UPDATE delivery.driver_reservations SET created_at = now() - INTERVAL '1 minute', expires_at = now() - INTERVAL '1 second' WHERE id = (SELECT reservation_id FROM delivery.delivery_offers WHERE id = $1)`,
      [offerId],
    );
    const worker = app.get(DeliveryExpiryWorker);
    expect(await worker.runOnce()).toBeGreaterThanOrEqual(1);
    expect(await worker.runOnce()).toBe(0);
    const state = await database.query<{
      offer_status: string;
      reservation_status: string;
      delivery_state: string;
      work_state: string;
    }>(
      `SELECT o.status AS offer_status, r.status AS reservation_status, d.state AS delivery_state, ws.work_state
       FROM delivery.delivery_offers o
       JOIN delivery.driver_reservations r ON r.id = o.reservation_id
       JOIN delivery.deliveries d ON d.id = o.delivery_id
       JOIN dispatch.driver_work_states ws ON ws.driver_user_id = o.driver_user_id
       WHERE o.id = $1`,
      [offerId],
    );
    expect(state.rows[0]).toMatchObject({
      offer_status: 'EXPIRED',
      reservation_status: 'EXPIRED',
      delivery_state: 'NO_DRIVER_AVAILABLE',
      work_state: 'AVAILABLE',
    });
  });

  it('records custody and recipient proof before completing a Delivery', async () => {
    const customer = await customerSession();
    const driver = await driverSession();
    await setAllAvailableDriversOffline();
    await approveDriver(driver.actorId);
    await sendLocationAndGoOnline(driver.accessToken);
    const created = await createDelivery(
      customer.accessToken,
      randomUUID(),
      deliveryPayload('Lifecycle'),
    );
    const deliveryId = created.json().id as string;
    const matching = await startMatching(
      customer.accessToken,
      deliveryId,
      randomUUID(),
    );
    const accepted = await acceptOffer(
      driver.accessToken,
      matching.json().offer.id as string,
      randomUUID(),
    );
    expect(accepted.statusCode).toBe(201);

    const arrived = await transitionDelivery(
      driver.accessToken,
      deliveryId,
      'arrive',
      randomUUID(),
    );
    expect(arrived.statusCode).toBe(201);
    expect(arrived.json()).toMatchObject({ state: 'AT_PICKUP', version: 3 });

    const missingProof = await completeDelivery(
      driver.accessToken,
      deliveryId,
      { recipientProof: '' },
      randomUUID(),
    );
    expect(missingProof.statusCode).toBe(400);

    const beforeCustody = await completeDelivery(
      driver.accessToken,
      deliveryId,
      { recipientProof: 'Attempt before custody' },
      randomUUID(),
    );
    expect(beforeCustody.statusCode).toBe(409);
    expect(beforeCustody.json().code).toBe('DELIVERY_INVALID_STATE');

    const pickupKey = randomUUID();
    const [pickedUp, pickupReplay] = await Promise.all([
      pickupDelivery(
        driver.accessToken,
        deliveryId,
        { custodyConfirmation: 'Parcel received intact' },
        pickupKey,
      ),
      pickupDelivery(
        driver.accessToken,
        deliveryId,
        { custodyConfirmation: 'Parcel received intact' },
        pickupKey,
      ),
    ]);
    expect(pickedUp.statusCode).toBe(201);
    expect(pickupReplay.json()).toEqual(pickedUp.json());
    expect(pickedUp.json()).toMatchObject({ state: 'IN_TRANSIT', version: 4 });

    const completeKey = randomUUID();
    const [completed, completeReplay] = await Promise.all([
      completeDelivery(
        driver.accessToken,
        deliveryId,
        { recipientProof: 'Recipient confirmed handoff' },
        completeKey,
      ),
      completeDelivery(
        driver.accessToken,
        deliveryId,
        { recipientProof: 'Recipient confirmed handoff' },
        completeKey,
      ),
    ]);
    expect(completed.statusCode).toBe(201);
    expect(completeReplay.json()).toEqual(completed.json());
    expect(completed.json()).toMatchObject({ state: 'DELIVERED', version: 5 });

    const durable = await database.query<{
      assignment_status: string;
      work_state: string;
      current_delivery_id: string | null;
      custody_confirmation: string;
      recipient_proof: string;
    }>(
      `SELECT a.status AS assignment_status, ws.work_state, ws.current_delivery_id,
              a.pickup_custody_confirmation AS custody_confirmation, p.confirmation_text AS recipient_proof
       FROM delivery.assignments a
       JOIN dispatch.driver_work_states ws ON ws.driver_user_id = a.driver_user_id
       JOIN delivery.delivery_proofs p ON p.delivery_id = a.delivery_id
       WHERE a.delivery_id = $1`,
      [deliveryId],
    );
    expect(durable.rows[0]).toMatchObject({
      assignment_status: 'COMPLETED',
      work_state: 'AVAILABLE',
      current_delivery_id: null,
      custody_confirmation: 'Parcel received intact',
      recipient_proof: 'Recipient confirmed handoff',
    });
  });

  it('returns Delivery status only to its assigned Driver', async () => {
    const customer = await customerSession();
    const driver = await driverSession();
    const otherDriver = await driverSession();
    await setAllAvailableDriversOffline();
    await approveDriver(driver.actorId);
    await approveDriver(otherDriver.actorId);
    await sendLocationAndGoOnline(driver.accessToken);
    const created = await createDelivery(
      customer.accessToken,
      randomUUID(),
      deliveryPayload('Driver read'),
    );
    const deliveryId = created.json().id as string;
    const matching = await startMatching(
      customer.accessToken,
      deliveryId,
      randomUUID(),
    );
    await acceptOffer(
      driver.accessToken,
      matching.json().offer.id as string,
      randomUUID(),
    );

    const ownRead = await server.inject({
      method: 'GET',
      url: `/api/v1/delivery-assignments/${deliveryId}`,
      headers: { authorization: `Bearer ${driver.accessToken}` },
    });
    expect(ownRead.statusCode).toBe(200);
    expect(ownRead.json()).toMatchObject({
      id: deliveryId,
      state: 'DRIVER_TO_PICKUP',
    });
    expect(ownRead.json()).not.toHaveProperty('recipientContactPhone');

    const otherRead = await server.inject({
      method: 'GET',
      url: `/api/v1/delivery-assignments/${deliveryId}`,
      headers: { authorization: `Bearer ${otherDriver.accessToken}` },
    });
    expect(otherRead.statusCode).toBe(404);
    expect(otherRead.json().code).toBe('DELIVERY_NOT_FOUND');
  });

  async function customerToken(): Promise<string> {
    return (await customerSession()).accessToken;
  }

  async function customerSession(): Promise<{
    accessToken: string;
    actorId: string;
  }> {
    const email = `delivery.customer.${randomUUID()}@gove.test`;
    const registration = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'idempotency-key': randomUUID() },
      payload: {
        email,
        displayName: 'Delivery Customer',
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
    return {
      accessToken: login.json().accessToken as string,
      actorId: registration.json().actor.id as string,
    };
  }

  async function driverSession(): Promise<{
    accessToken: string;
    actorId: string;
  }> {
    const email = `delivery.driver.${randomUUID()}@gove.test`;
    const registration = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'idempotency-key': randomUUID() },
      payload: {
        email,
        displayName: 'Delivery Driver',
        password,
        requestedRole: 'DRIVER',
      },
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

  async function approveDriver(driverId: string): Promise<void> {
    await database.query(
      `UPDATE driver.driver_profiles SET approval_status = 'APPROVED', reviewed_at = now() WHERE user_id = $1`,
      [driverId],
    );
    await database.query(
      `INSERT INTO driver.vehicles (id, driver_user_id, vehicle_class, make, model, model_year, plate_normalized, approval_status, is_selected)
       VALUES ($1, $2, 'MOTORBIKE', 'Demo', 'Delivery', 2024, $3, 'APPROVED', true)`,
      [
        randomUUID(),
        driverId,
        `DV${randomUUID().replaceAll('-', '').slice(0, 14).toUpperCase()}`,
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

  async function setAllAvailableDriversOffline(): Promise<void> {
    await database.query(
      `UPDATE dispatch.driver_work_states SET work_state = 'OFFLINE', state_version = state_version + 1, state_changed_at = now(), updated_at = now() WHERE work_state = 'AVAILABLE'`,
    );
  }

  function createDelivery(
    accessToken: string,
    idempotencyKey: string,
    payload: DeliveryPayload,
  ) {
    return server.inject({
      method: 'POST',
      url: '/api/v1/deliveries',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': idempotencyKey,
      },
      payload,
    });
  }

  function deliveryPayload(label: string): DeliveryPayload {
    return {
      pickup: { label: `${label} pickup`, latitude: 10.76, longitude: 106.68 },
      dropoff: { label: `${label} dropoff`, latitude: 10.78, longitude: 106.7 },
      recipient: {
        displayName: `${label} Recipient`,
        contactPhone: '+84901234567',
      },
      parcel: { description: `${label} parcel`, declaredWeightGrams: 700 },
    };
  }

  function startMatching(
    accessToken: string,
    deliveryId: string,
    idempotencyKey: string,
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/deliveries/${deliveryId}/match`,
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
      url: `/api/v1/delivery-offers/${offerId}/accept`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': idempotencyKey,
      },
    });
  }

  function transitionDelivery(
    accessToken: string,
    deliveryId: string,
    action: 'arrive',
    idempotencyKey: string,
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/deliveries/${deliveryId}/${action}`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': idempotencyKey,
      },
    });
  }

  function pickupDelivery(
    accessToken: string,
    deliveryId: string,
    payload: { custodyConfirmation: string },
    idempotencyKey: string,
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/deliveries/${deliveryId}/pickup`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': idempotencyKey,
      },
      payload,
    });
  }

  function completeDelivery(
    accessToken: string,
    deliveryId: string,
    payload: { recipientProof: string },
    idempotencyKey: string,
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/deliveries/${deliveryId}/complete`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': idempotencyKey,
      },
      payload,
    });
  }
});
