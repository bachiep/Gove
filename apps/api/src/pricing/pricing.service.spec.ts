import { describe, expect, it, vi } from 'vitest';

import type { FareQuoteResponse } from '@gove/contracts';

import { ApiError } from '../common/http/api-error.js';
import { RoutingService } from '../routing/index.js';
import { PricingRepository } from './pricing.repository.js';
import { PricingService } from './pricing.service.js';

const pickup = {
  label: 'Hồ Hoàn Kiếm',
  latitude: 21.0285,
  longitude: 105.8542,
} as const;

const dropoff = {
  label: 'Văn Miếu – Quốc Tử Giám',
  latitude: 21.0278,
  longitude: 105.8342,
} as const;

const quoteResponse: FareQuoteResponse = {
  id: 'quote-1',
  serviceType: 'MOTORBIKE_STANDARD',
  pickup,
  dropoff,
  estimatedDistanceMeters: 1_234,
  estimatedDurationSeconds: 60,
  currency: 'VND',
  totalFareMinor: 25_000,
  expiresAt: '2026-09-24T08:05:00.000Z',
};

function createSubject(routing: RoutingService) {
  const repository = {
    findFareQuoteReceipt: vi.fn().mockResolvedValue(null),
    createFareQuote: vi.fn().mockResolvedValue(quoteResponse),
  } as unknown as PricingRepository;

  return {
    service: new PricingService(repository, routing),
    repository,
  };
}

describe('PricingService routing boundary', () => {
  it('accepts the confirmed Hanoi inner-city boundary coordinates', async () => {
    const route = vi.fn().mockResolvedValue({
      distanceMeters: 1_234,
      durationSeconds: 247,
      geometry: {
        type: 'LineString',
        coordinates: [
          [105.76, 20.98],
          [105.9, 21.1],
        ],
      },
      metadata: {
        provider: 'test-provider',
        version: 'v1',
        updatedAt: '2026-09-24T08:00:00.000Z',
      },
      usedFallback: false,
      fallbackReason: null,
    });
    const { service, repository } = createSubject({
      route,
    } as unknown as RoutingService);

    await expect(
      service.createFareQuote({
        customerUserId: 'customer-1',
        idempotencyKey: 'quote-key-hanoi-boundary',
        pickup: {
          label: 'Southwest boundary',
          latitude: 20.98,
          longitude: 105.76,
        },
        dropoff: {
          label: 'Northeast boundary',
          latitude: 21.1,
          longitude: 105.9,
        },
        serviceType: 'MOTORBIKE_STANDARD',
      }),
    ).resolves.toEqual(quoteResponse);

    expect(repository.createFareQuote).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['south of the Hanoi service area', { ...pickup, latitude: 20.9799 }],
    ['north of the Hanoi service area', { ...pickup, latitude: 21.1001 }],
    ['west of the Hanoi service area', { ...pickup, longitude: 105.7599 }],
    ['east of the Hanoi service area', { ...pickup, longitude: 105.9001 }],
  ])('rejects a pickup %s', async (_description, outsidePickup) => {
    const route = vi.fn();
    const { service, repository } = createSubject({
      route,
    } as unknown as RoutingService);

    await expect(
      service.createFareQuote({
        customerUserId: 'customer-1',
        idempotencyKey: `quote-key-outside-${_description}`,
        pickup: outsidePickup,
        dropoff,
        serviceType: 'MOTORBIKE_STANDARD',
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'OUTSIDE_SERVICE_AREA',
    });

    expect(route).not.toHaveBeenCalled();
    expect(repository.createFareQuote).not.toHaveBeenCalled();
  });

  it('uses RoutingService output for quote metering instead of recalculating Haversine', async () => {
    const route = vi.fn().mockResolvedValue({
      distanceMeters: 1_234.6,
      durationSeconds: 12,
      geometry: {
        type: 'LineString',
        coordinates: [
          [pickup.longitude, pickup.latitude],
          [dropoff.longitude, dropoff.latitude],
        ],
      },
      metadata: {
        provider: 'coordinate-fallback',
        version: 'coordinate-fallback-v1',
        updatedAt: '2026-09-24T08:00:00.000Z',
      },
      usedFallback: true,
      fallbackReason: 'PRIMARY_NOT_CONFIGURED',
    });
    const { service, repository } = createSubject({
      route,
    } as unknown as RoutingService);

    await service.createFareQuote({
      customerUserId: 'customer-1',
      idempotencyKey: 'quote-key-1',
      pickup,
      dropoff,
      serviceType: 'MOTORBIKE_STANDARD',
    });

    expect(route).toHaveBeenCalledWith({
      origin: { latitude: pickup.latitude, longitude: pickup.longitude },
      destination: { latitude: dropoff.latitude, longitude: dropoff.longitude },
      profile: 'DRIVING',
    });
    expect(repository.createFareQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        distanceMeters: 1_235,
        durationSeconds: 60,
      }),
    );
  });

  it('exposes deterministic fallback provenance so the UI cannot present it as a road route', async () => {
    const { service, repository } = createSubject(
      new RoutingService({ now: () => new Date('2026-09-24T08:00:00.000Z') }),
    );

    const result = await service.createFareQuote({
      customerUserId: 'customer-1',
      idempotencyKey: 'quote-key-2',
      pickup,
      dropoff,
      serviceType: 'MOTORBIKE_STANDARD',
    });

    expect(repository.createFareQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        distanceMeters: 2_077,
        durationSeconds: 416,
        route: expect.objectContaining({
          provider: 'coordinate-fallback',
          version: 'coordinate-fallback-v1',
          usedFallback: true,
          fallbackReason: 'PRIMARY_NOT_CONFIGURED',
        }),
      }),
    );
    expect(result).not.toHaveProperty('route');
  });

  it('maps an unavailable routing boundary to a truthful service-unavailable error', async () => {
    const { service } = createSubject({
      route: vi
        .fn()
        .mockRejectedValue(
          new ApiError(
            503,
            'ROUTING_UNAVAILABLE',
            'A route estimate is temporarily unavailable.',
          ),
        ),
    } as unknown as RoutingService);

    await expect(
      service.createFareQuote({
        customerUserId: 'customer-1',
        idempotencyKey: 'quote-key-3',
        pickup,
        dropoff,
        serviceType: 'MOTORBIKE_STANDARD',
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'ROUTING_UNAVAILABLE',
    });
  });

  it('rejects identical coordinates before routing instead of leaking a database constraint error', async () => {
    const route = vi.fn();
    const { service, repository } = createSubject({
      route,
    } as unknown as RoutingService);

    await expect(
      service.createFareQuote({
        customerUserId: 'customer-1',
        idempotencyKey: 'quote-key-identical',
        pickup,
        dropoff: { ...pickup, label: 'Same coordinate' },
        serviceType: 'MOTORBIKE_STANDARD',
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'RIDE_POINTS_IDENTICAL',
    });

    expect(route).not.toHaveBeenCalled();
    expect(repository.createFareQuote).not.toHaveBeenCalled();
  });

  it('returns a completed idempotent receipt without depending on routing availability', async () => {
    const route = vi
      .fn()
      .mockRejectedValue(new Error('routing is unavailable'));
    const { service, repository } = createSubject({
      route,
    } as unknown as RoutingService);
    vi.mocked(repository.findFareQuoteReceipt).mockResolvedValue(quoteResponse);

    await expect(
      service.createFareQuote({
        customerUserId: 'customer-1',
        idempotencyKey: 'quote-key-existing',
        pickup,
        dropoff,
        serviceType: 'MOTORBIKE_STANDARD',
      }),
    ).resolves.toEqual(quoteResponse);

    expect(route).not.toHaveBeenCalled();
    expect(repository.createFareQuote).not.toHaveBeenCalled();
  });

  it('coalesces concurrent identical requests before calling routing', async () => {
    const route = vi.fn().mockResolvedValue({
      distanceMeters: 1_234,
      durationSeconds: 247,
      geometry: {
        type: 'LineString',
        coordinates: [
          [pickup.longitude, pickup.latitude],
          [dropoff.longitude, dropoff.latitude],
        ],
      },
      metadata: {
        provider: 'test-provider',
        version: 'v1',
        updatedAt: '2026-09-24T08:00:00.000Z',
      },
      usedFallback: false,
      fallbackReason: null,
    });
    const { service, repository } = createSubject({
      route,
    } as unknown as RoutingService);
    const input = {
      customerUserId: 'customer-1',
      idempotencyKey: 'quote-key-concurrent',
      pickup,
      dropoff,
      serviceType: 'MOTORBIKE_STANDARD' as const,
    };

    await expect(
      Promise.all([
        service.createFareQuote(input),
        service.createFareQuote(input),
      ]),
    ).resolves.toEqual([quoteResponse, quoteResponse]);

    expect(repository.findFareQuoteReceipt).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledTimes(1);
    expect(repository.createFareQuote).toHaveBeenCalledTimes(1);
  });
});
