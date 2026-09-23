import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module.js';
import { LocationModule } from '../location/location.module.js';
import { RealtimeController } from './realtime.controller.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeRepository } from './realtime.repository.js';

@Module({
  imports: [IdentityModule, LocationModule],
  controllers: [RealtimeController],
  providers: [RealtimeGateway, RealtimeRepository],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
