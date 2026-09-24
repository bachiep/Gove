import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../main.js';

describe('Identity HTTP seam', () => {
  let app: Awaited<ReturnType<typeof createApplication>>;
  let server: FastifyInstance;
  const email = `identity.integration.${randomUUID()}@gove.test`;
  const password = 'correct horse battery staple';
  const idempotencyKey = randomUUID();

  beforeAll(async () => {
    app = await createApplication();
    await app.init();
    server = app.getHttpAdapter().getInstance();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers idempotently, authenticates, rotates, and revokes a Driver session', async () => {
    const registration = {
      email,
      displayName: 'Integration Driver',
      password,
      requestedRole: 'DRIVER',
    };
    const [first, concurrentRetry] = await Promise.all([
      server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { 'idempotency-key': idempotencyKey },
        payload: registration,
      }),
      server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { 'idempotency-key': idempotencyKey },
        payload: registration,
      }),
    ]);
    expect(first.statusCode).toBe(201);
    expect(first.json().actor.roles).toEqual(['DRIVER']);
    expect(concurrentRetry.statusCode).toBe(201);
    expect(concurrentRetry.json().actor.id).toBe(first.json().actor.id);

    const retry = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'idempotency-key': idempotencyKey },
      payload: registration,
    });
    expect(retry.statusCode).toBe(201);
    expect(retry.json().actor.id).toBe(first.json().actor.id);

    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers['x-ratelimit-limit']).toBe('60');
    expect(login.headers['x-ratelimit-remaining']).toBe('59');
    const authentication = login.json();
    const cookie = cookieValue(login.headers['set-cookie']);
    expect(cookie).toContain('gove_refresh=');

    const missingOrigin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie },
    });
    expect(missingOrigin.statusCode).toBe(403);
    expect(missingOrigin.json().code).toBe('AUTH_ORIGIN_FORBIDDEN');

    const unsupportedOrigin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie, origin: 'https://untrusted.example' },
    });
    expect(unsupportedOrigin.statusCode).toBe(403);
    expect(unsupportedOrigin.json().code).toBe('AUTH_ORIGIN_FORBIDDEN');

    const me = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${authentication.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().actor.email).toBe(email);

    const refresh = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie, origin: 'http://localhost:5173' },
    });
    expect(refresh.statusCode).toBe(200);
    const rotatedCookie = cookieValue(refresh.headers['set-cookie']);

    const logout = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: rotatedCookie, origin: 'http://localhost:5173' },
    });
    expect(logout.statusCode).toBe(204);

    const revoked = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: rotatedCookie, origin: 'http://localhost:5173' },
    });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json().code).toBe('AUTH_SESSION_INVALID');
  });

  it('rejects an unsupported self-selected role', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'idempotency-key': randomUUID() },
      payload: {
        email: `operator.integration.${randomUUID()}@gove.test`,
        displayName: 'Not An Operator',
        password,
        requestedRole: 'OPERATOR',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_FAILED');
  });
});

function cookieValue(
  header: string | string[] | undefined,
): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.split(';', 1)[0];
}
