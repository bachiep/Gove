import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module.js';
import { DriverLocationRateLimiter } from './driver-location-rate-limiter.js';
import { LocationController } from './location.controller.js';
import { LocationRepository } from './location.repository.js';
import { LocationService } from './location.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [LocationController],
  providers: [DriverLocationRateLimiter, LocationRepository, LocationService],
  exports: [LocationService, LocationRepository],
})
export class LocationModule {}
