import { HttpAdapterHost } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { AuthService } from '../identity/auth.service.js';
import type { SessionActor } from '../identity/identity.types.js';
import { LocationService } from '../location/location.service.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeRepository } from './realtime.repository.js';

interface RevalidationState {
  socket: WebSocket;
  actor: SessionActor | null;
  accessToken: string | null;
  authRevalidation: Promise<void> | null;
}

interface RealtimeGatewayInternals {
  revalidateAuthentication(state: RevalidationState): Promise<void>;
}

describe('RealtimeGateway authentication revalidation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shares one in-flight revalidation between concurrent heartbeat calls', async () => {
    const actor = fakeActor();
    let resolveAuthentication!: (value: SessionActor) => void;
    const authentication = new Promise<SessionActor>((resolve) => {
      resolveAuthentication = resolve;
    });
    const authenticateAccessToken = vi.fn(() => authentication);
    const gateway = createGateway(authenticateAccessToken);
    const state = createState(actor);
    const revalidate = (gateway as unknown as RealtimeGatewayInternals)
      .revalidateAuthentication;

    const first = revalidate.call(gateway, state);
    const second = revalidate.call(gateway, state);

    expect(authenticateAccessToken).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    resolveAuthentication(actor);
    await Promise.all([first, second]);
    expect(state.authRevalidation).toBeNull();
  });

  it('sends AUTH_REAUTH_REQUIRED and closes with 1008 when validation fails', async () => {
    const sent: string[] = [];
    let close: { code: number; reason: string } | null = null;
    const socket = {
      readyState: WebSocket.OPEN,
      send(payload: string) {
        sent.push(payload);
      },
      close(code: number, reason: string) {
        close = { code, reason };
      },
    } as unknown as WebSocket;
    const authenticateAccessToken = vi.fn(() =>
      Promise.reject(new Error('access token expired')),
    );
    const gateway = createGateway(authenticateAccessToken);
    const state = createState(fakeActor(), socket);
    const revalidate = (gateway as unknown as RealtimeGatewayInternals)
      .revalidateAuthentication;

    await revalidate.call(gateway, state);

    expect(sent).toEqual([
      JSON.stringify({
        type: 'error',
        code: 'AUTH_REAUTH_REQUIRED',
        message:
          'Realtime authentication expired or was revoked. Authenticate again.',
      }),
    ]);
    expect(close).toEqual({ code: 1008, reason: 'AUTH_REAUTH_REQUIRED' });
  });
});

function createGateway(
  authenticateAccessToken: (token: string) => Promise<SessionActor>,
): RealtimeGateway {
  return new RealtimeGateway(
    {} as HttpAdapterHost,
    { authenticateAccessToken } as unknown as AuthService,
    {} as LocationService,
    {} as RealtimeRepository,
  );
}

function createState(
  actor: SessionActor,
  socket?: WebSocket,
): RevalidationState {
  return {
    socket: socket ?? ({ readyState: WebSocket.OPEN } as WebSocket),
    actor,
    accessToken: 'test-access-token',
    authRevalidation: null,
  };
}

function fakeActor(): SessionActor {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'realtime.test@gove.test',
    displayName: 'Realtime Test',
    roles: ['CUSTOMER'],
    authEpoch: 1,
    sessionId: '00000000-0000-0000-0000-000000000002',
  };
}
