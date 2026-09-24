import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocationRepository } from './location.repository.js';
import { DriverLocationRateLimiter } from './driver-location-rate-limiter.js';
import { LocationService } from './location.service.js';

describe('LocationService', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalJwtSecret = process.env.AUTH_JWT_SECRET;
  const originalRefreshPepper = process.env.AUTH_REFRESH_PEPPER;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalJwtSecret === undefined) delete process.env.AUTH_JWT_SECRET;
    else process.env.AUTH_JWT_SECRET = originalJwtSecret;
    if (originalRefreshPepper === undefined)
      delete process.env.AUTH_REFRESH_PEPPER;
    else process.env.AUTH_REFRESH_PEPPER = originalRefreshPepper;
  });

  it('rejects simulator locations in production before rate limiting or persistence', async () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_JWT_SECRET = 'j'.repeat(32);
    process.env.AUTH_REFRESH_PEPPER = 'r'.repeat(32);
    const repository = {
      upsertLatest: vi.fn(),
    } as unknown as LocationRepository;
    const rateLimiter = {
      tryAccept: vi.fn().mockReturnValue(true),
    } as unknown as DriverLocationRateLimiter;
    const service = new LocationService(repository, rateLimiter);

    await expect(
      service.updateLatest('driver-1', {
        latitude: 21.0285,
        longitude: 105.8048,
        accuracyMeters: 10,
        source: 'SIMULATOR',
        sequenceNumber: 1,
      }),
    ).rejects.toMatchObject({
      code: 'DRIVER_LOCATION_SIMULATOR_DISABLED',
      httpStatus: 400,
      details: [
        { field: 'source', reason: 'simulator_disabled_in_production' },
      ],
    });
    expect(rateLimiter.tryAccept).not.toHaveBeenCalled();
    expect(repository.upsertLatest).not.toHaveBeenCalled();
  });
});
