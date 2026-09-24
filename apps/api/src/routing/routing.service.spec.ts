import { describe, expect, it, vi } from 'vitest';

import { CoordinateFallbackRoutingProvider, RoutingService } from './index.js';
import type { RoutingEstimate } from './routing.types.js';

const routeRequest = {
  origin: { latitude: 10.7765, longitude: 106.7009 },
  destination: { latitude: 10.7812, longitude: 106.6941 },
  profile: 'DRIVING' as const,
};

const fixedNow = () => new Date('2026-09-24T08:00:00.000Z');

describe('RoutingService', () => {
  it('returns deterministic coordinate fallback data with explicit metadata', async () => {
    const routing = new RoutingService({ now: fixedNow });

    const first = await routing.route(routeRequest);
    const second = await routing.route(routeRequest);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      distanceMeters: 908,
      durationSeconds: 182,
      metadata: {
        provider: 'coordinate-fallback',
        version: 'coordinate-fallback-v1',
        updatedAt: '2026-09-24T08:00:00.000Z',
      },
      usedFallback: true,
      fallbackReason: 'PRIMARY_NOT_CONFIGURED',
      geometry: {
        type: 'LineString',
        coordinates: [
          [106.7009, 10.7765],
          [106.6941, 10.7812],
        ],
      },
    });
  });

  it('uses a healthy provider and records its version without fallback', async () => {
    const routing = new RoutingService({
      now: fixedNow,
      primaryProvider: {
        id: 'test-routing-provider',
        version: 'test-v2',
        route: vi.fn().mockResolvedValue({
          distanceMeters: 1_234,
          durationSeconds: 98,
          geometry: {
            type: 'LineString',
            coordinates: [
              [106.7009, 10.7765],
              [106.699, 10.778],
              [106.6941, 10.7812],
            ],
          },
        }),
      },
    });

    await expect(routing.route(routeRequest)).resolves.toMatchObject({
      distanceMeters: 1_234,
      durationSeconds: 98,
      metadata: {
        provider: 'test-routing-provider',
        version: 'test-v2',
        updatedAt: '2026-09-24T08:00:00.000Z',
      },
      usedFallback: false,
      fallbackReason: null,
    });
  });

  it('falls back when the provider rejects and preserves the reason', async () => {
    const routing = new RoutingService({
      now: fixedNow,
      primaryProvider: {
        id: 'unavailable-provider',
        version: 'provider-v1',
        route: vi.fn().mockRejectedValue(new Error('provider unavailable')),
      },
    });

    await expect(routing.route(routeRequest)).resolves.toMatchObject({
      metadata: {
        provider: 'coordinate-fallback',
        version: 'coordinate-fallback-v1',
      },
      usedFallback: true,
      fallbackReason: 'PRIMARY_ERROR',
    });
  });

  it('bounds a hanging provider by timeout, aborts it, and uses fallback', async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const routing = new RoutingService({
        now: fixedNow,
        timeoutMs: 25,
        primaryProvider: {
          id: 'hanging-provider',
          version: 'provider-v1',
          route: (_input, signal) =>
            new Promise<RoutingEstimate>(() => {
              signal.addEventListener('abort', () => {
                aborted = true;
              });
            }),
        },
      });

      const resultPromise = routing.route(routeRequest);
      await vi.advanceTimersByTimeAsync(25);
      const result = await resultPromise;

      expect(aborted).toBe(true);
      expect(result).toMatchObject({
        metadata: { provider: 'coordinate-fallback' },
        usedFallback: true,
        fallbackReason: 'PRIMARY_TIMEOUT',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait indefinitely when a configured fallback also hangs', async () => {
    vi.useFakeTimers();
    try {
      const routing = new RoutingService({
        timeoutMs: 25,
        primaryProvider: {
          id: 'failing-provider',
          version: 'provider-v1',
          route: async () => Promise.reject(new Error('provider unavailable')),
        },
        fallbackProvider: {
          id: 'configured-fallback',
          version: 'fallback-v1',
          route: async () => new Promise<RoutingEstimate>(() => undefined),
        },
      });

      const resultPromise = routing.route(routeRequest);
      const rejected = expect(resultPromise).rejects.toMatchObject({
        code: 'ROUTING_UNAVAILABLE',
      });
      await vi.advanceTimersByTimeAsync(25);

      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects invalid coordinates before invoking a provider', async () => {
    const route = vi.fn(async (): Promise<RoutingEstimate> =>
      Promise.reject(new Error('must not be called')),
    );
    const routing = new RoutingService({
      primaryProvider: {
        id: 'test-routing-provider',
        version: 'test-v1',
        route,
      },
    });

    await expect(
      routing.route({
        ...routeRequest,
        origin: { latitude: 91, longitude: 106.7009 },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ROUTING_INPUT' });
    expect(route).not.toHaveBeenCalled();
  });
});

describe('CoordinateFallbackRoutingProvider', () => {
  it('rejects an invalid configured speed instead of producing misleading ETA', () => {
    expect(
      () => new CoordinateFallbackRoutingProvider({ speedMetersPerSecond: 0 }),
    ).toThrowError(/speedMetersPerSecond/);
  });
});
