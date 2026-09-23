import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../main.js';

describe('Quote and Trip HTTP seam', () => {
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

  it('replays a quote and creates one idempotent requested Trip', async () => {
    const accessToken = await customerToken();
    const quoteKey = randomUUID();
    const firstQuote = await createQuote(accessToken, quoteKey);
    expect(firstQuote.statusCode).toBe(201);

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
        dropoff: { label: 'Demo dropoff', latitude: 10.78, longitude: 106.7 },
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
        pickup: { label: 'Demo pickup', latitude: 10.76, longitude: 106.68 },
        dropoff: { label: 'Demo dropoff', latitude: 10.78, longitude: 106.7 },
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
});
