import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module.js';
import { DeliveryController } from './delivery.controller.js';
import { DeliveryOfferController } from './delivery-offer.controller.js';
import { DeliveryExpiryWorker } from './delivery-expiry.worker.js';
import { DeliveryRepository } from './delivery.repository.js';
import { DeliveryService } from './delivery.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [DeliveryController, DeliveryOfferController],
  providers: [DeliveryExpiryWorker, DeliveryRepository, DeliveryService],
})
export class DeliveryModule {}
