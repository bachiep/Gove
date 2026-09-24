import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { ApiError } from '../common/http/api-error.js';
import { readAppConfig } from '../config/app-config.js';
import { DriverLocationRateLimiter } from './driver-location-rate-limiter.js';
import { LocationRepository } from './location.repository.js';
import type { LatestLocationInput } from './location.schemas.js';

@Injectable()
export class LocationService {
  private readonly config = readAppConfig();

  constructor(
    @Inject(LocationRepository) private readonly repository: LocationRepository,
    @Inject(DriverLocationRateLimiter)
    private readonly rateLimiter: DriverLocationRateLimiter,
  ) {}

  async updateLatest(driverUserId: string, input: LatestLocationInput) {
    if (this.config.NODE_ENV === 'production' && input.source === 'SIMULATOR') {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'DRIVER_LOCATION_SIMULATOR_DISABLED',
        'Simulator location updates are disabled in production.',
        [{ field: 'source', reason: 'simulator_disabled_in_production' }],
      );
    }
    if (!this.rateLimiter.tryAccept(driverUserId)) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'DRIVER_LOCATION_RATE_LIMITED',
        'Driver location updates are limited to one accepted update every 3 seconds.',
        [{ field: 'location', reason: 'rate_limited' }],
      );
    }
    return this.repository.upsertLatest(driverUserId, input);
  }
}
