import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApplication } from '../main.js';

describe('Location HTTP seam', () => {
  let app: Awaited<ReturnType<typeof createApplication>>;
  let server: FastifyInstance;

  beforeAll(async () => {
    app = await createApplication();
    await app.init();
    server = app.getHttpAdapter().getInstance();
  });

  afterAll(async () => {
    await app.close();
  });

  it('throttles a Driver location write, then accepts it after the window', async () => {
    const accessToken = await registerAndLoginDriver();
    const dateNow = vi.spyOn(Date, 'now');
    dateNow.mockReturnValue(1_000_000);

    try {
      const first = await updateLocation(accessToken, 1);
      const throttled = await updateLocation(accessToken, 2);
      dateNow.mockReturnValue(1_003_000);
      const afterWindow = await updateLocation(accessToken, 3);

      expect(first.statusCode).toBe(200);
      expect(throttled.statusCode).toBe(429);
      expect(throttled.json()).toMatchObject({
        code: 'DRIVER_LOCATION_RATE_LIMITED',
        details: [{ field: 'location', reason: 'rate_limited' }],
      });
      expect(afterWindow.statusCode).toBe(200);
    } finally {
      dateNow.mockRestore();
    }
  });

  it('rejects stale, duplicate, and out-of-order sequences without regressing Latest Location', async () => {
    const accessToken = await registerAndLoginDriver();
    const baseCapturedAt = new Date().getTime();
    const dateNow = vi.spyOn(Date, 'now');

    dateNow.mockReturnValue(2_000_000);
    const initial = await updateLocation(accessToken, 10, {
      capturedAt: new Date(baseCapturedAt).toISOString(),
      latitude: 21.0285,
      longitude: 105.8048,
    });

    dateNow.mockReturnValue(2_003_000);
    const newest = await updateLocation(accessToken, 12, {
      capturedAt: new Date(baseCapturedAt + 2_000).toISOString(),
      latitude: 21.03,
      longitude: 105.81,
    });

    dateNow.mockReturnValue(2_006_000);
    const outOfOrder = await updateLocation(accessToken, 11, {
      capturedAt: new Date(baseCapturedAt + 1_000).toISOString(),
      latitude: 21.029,
      longitude: 105.805,
    });

    dateNow.mockReturnValue(2_009_000);
    const duplicate = await updateLocation(accessToken, 12, {
      capturedAt: new Date(baseCapturedAt + 2_000).toISOString(),
      latitude: 21.031,
      longitude: 105.811,
    });

    dateNow.mockReturnValue(2_012_000);
    const stale = await updateLocation(accessToken, 9, {
      capturedAt: new Date(baseCapturedAt).toISOString(),
      latitude: 21.027,
      longitude: 105.803,
    });

    dateNow.mockRestore();

    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      accepted: true,
      sequence_number: '10',
      captured_at: new Date(baseCapturedAt).toISOString(),
    });
    expect(newest.statusCode).toBe(200);
    expect(newest.json()).toMatchObject({
      accepted: true,
      sequence_number: '12',
      captured_at: new Date(baseCapturedAt + 2_000).toISOString(),
    });

    for (const rejected of [outOfOrder, duplicate, stale]) {
      expect(rejected.statusCode).toBe(200);
      expect(rejected.json()).toMatchObject({
        accepted: false,
        sequence_number: '12',
        captured_at: new Date(baseCapturedAt + 2_000).toISOString(),
      });
    }
  });

  async function registerAndLoginDriver(): Promise<string> {
    const email = `location-${randomUUID()}@example.test`;
    const password = 'correct horse battery staple';
    const registration = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'idempotency-key': randomUUID() },
      payload: {
        email,
        displayName: 'Location Driver',
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
    return login.json().accessToken as string;
  }

  function updateLocation(
    accessToken: string,
    sequenceNumber: number,
    overrides: Partial<{
      capturedAt: string;
      latitude: number;
      longitude: number;
    }> = {},
  ) {
    return server.inject({
      method: 'PUT',
      url: '/api/v1/drivers/me/location',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        latitude: 21.0285,
        longitude: 105.8048,
        accuracyMeters: 10,
        source: 'SIMULATOR',
        sequenceNumber,
        ...overrides,
      },
    });
  }
});
