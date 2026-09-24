import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPricingRoutingService } from './pricing.module.js';

const routeRequest = {
  origin: { latitude: 21.0285, longitude: 105.8542 },
  destination: { latitude: 21.028, longitude: 105.8357 },
  profile: 'DRIVING' as const,
};

describe('createPricingRoutingService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the coordinate fallback without issuing a network request when OSRM is not configured', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    const result = await createPricingRoutingService({}).route(routeRequest);

    expect(fetch).not.toHaveBeenCalled();
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe('PRIMARY_NOT_CONFIGURED');
    expect(result.metadata.provider).toBe('coordinate-fallback');
  });

  it('uses OSRM as the primary provider when configured', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'Ok',
          routes: [
            {
              distance: 2_100,
              duration: 420,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [105.8542, 21.0285],
                  [105.8357, 21.028],
                ],
              },
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);

    const result = await createPricingRoutingService({
      ROUTING_OSRM_BASE_URL: 'http://127.0.0.1:5000',
    }).route(routeRequest);

    expect(fetch).toHaveBeenCalledOnce();
    expect(result.usedFallback).toBe(false);
    expect(result.metadata.provider).toBe('osrm');
  });
});
