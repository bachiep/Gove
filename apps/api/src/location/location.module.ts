import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module.js';
import { LocationController } from './location.controller.js';
import { LocationRepository } from './location.repository.js';
import { LocationService } from './location.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [LocationController],
  providers: [LocationRepository, LocationService],
  exports: [LocationService, LocationRepository],
})
export class LocationModule {}
