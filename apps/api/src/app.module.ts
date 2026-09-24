import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module.js';
import { DeliveryModule } from './delivery/delivery.module.js';
import { DispatchModule } from './dispatch/dispatch.module.js';
import { DriverModule } from './driver/driver.module.js';
import { HealthController } from './health/health.controller.js';
import { IdentityModule } from './identity/identity.module.js';
import { LocationModule } from './location/location.module.js';
import { OperatorModule } from './operator/operator.module.js';
import { PaymentModule } from './payment/payment.module.js';
import { PricingModule } from './pricing/pricing.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { TripModule } from './trip/trip.module.js';

@Module({
  imports: [
    DatabaseModule,
    DeliveryModule,
    DispatchModule,
    IdentityModule,
    DriverModule,
    LocationModule,
    OperatorModule,
    PaymentModule,
    PricingModule,
    RealtimeModule,
    TripModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
