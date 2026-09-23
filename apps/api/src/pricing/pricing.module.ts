import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module.js';
import { PricingController } from './pricing.controller.js';
import { PricingRepository } from './pricing.repository.js';
import { PricingService } from './pricing.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [PricingController],
  providers: [PricingRepository, PricingService],
  exports: [PricingRepository],
})
export class PricingModule {}
