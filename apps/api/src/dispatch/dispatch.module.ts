import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module.js';
import { DispatchController } from './dispatch.controller.js';
import { DispatchRepository } from './dispatch.repository.js';
import { DispatchService } from './dispatch.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [DispatchController],
  providers: [DispatchRepository, DispatchService],
})
export class DispatchModule {}
