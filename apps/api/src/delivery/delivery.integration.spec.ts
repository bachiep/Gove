import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../main.js';

interface DeliveryPayload {
  pickup: { label: string; latitude: number; longitude: number };
  dropoff: { label: string; latitude: number; longitude: number };
  recipient: { displayName: string; contactPhone: string };
  parcel: { description: string; declaredWeightGrams: number };
}

describe('Delivery HTTP seam', () => {
  let app: Awaited<ReturnType<typeof createApplication>>;
  let server: FastifyInstance;
  const password = 'correct horse battery staple';

  beforeAll(async () => {
    app = await createApplication();
    await app.init();
    server = app.getHttpAdapter().getInstance();
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

  async function customerToken(): Promise<string> {
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
    return login.json().accessToken as string;
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
});
