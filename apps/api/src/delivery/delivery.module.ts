import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module.js';
import { DeliveryController } from './delivery.controller.js';
import { DeliveryRepository } from './delivery.repository.js';
import { DeliveryService } from './delivery.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [DeliveryController],
  providers: [DeliveryRepository, DeliveryService],
})
export class DeliveryModule {}
