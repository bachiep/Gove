import { Module } from '@nestjs/common';

import { readAppConfig, type AppConfig } from '../config/app-config.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OsrmRoutingProvider, RoutingService } from '../routing/index.js';
import { PricingController } from './pricing.controller.js';
import { PricingRepository } from './pricing.repository.js';
import { PricingService } from './pricing.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [PricingController],
  providers: [
    PricingRepository,
    PricingService,
    {
      provide: RoutingService,
      useFactory: () => createPricingRoutingService(readAppConfig()),
    },
  ],
  exports: [PricingRepository],
})
export class PricingModule {}

export function createPricingRoutingService(
  config: Pick<AppConfig, 'ROUTING_OSRM_BASE_URL'>,
): RoutingService {
  return new RoutingService({
    primaryProvider: config.ROUTING_OSRM_BASE_URL
      ? new OsrmRoutingProvider({ baseUrl: config.ROUTING_OSRM_BASE_URL })
      : undefined,
  });
}
