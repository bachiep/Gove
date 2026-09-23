import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module.js';
import { TripController } from './trip.controller.js';
import { TripRepository } from './trip.repository.js';
import { TripService } from './trip.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [TripController],
  providers: [TripRepository, TripService],
})
export class TripModule {}
