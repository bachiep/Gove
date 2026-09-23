import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module.js';
import { DispatchModule } from './dispatch/dispatch.module.js';
import { DriverModule } from './driver/driver.module.js';
import { HealthController } from './health/health.controller.js';
import { IdentityModule } from './identity/identity.module.js';
import { LocationModule } from './location/location.module.js';
import { PricingModule } from './pricing/pricing.module.js';
import { TripModule } from './trip/trip.module.js';

@Module({
  imports: [
    DatabaseModule,
    DispatchModule,
    IdentityModule,
    DriverModule,
    LocationModule,
    PricingModule,
    TripModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
