import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module.js';
import { DispatchController } from './dispatch.controller.js';
import { DispatchExpiryWorker } from './dispatch-expiry.worker.js';
import { DispatchRepository } from './dispatch.repository.js';
import { DispatchService } from './dispatch.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [DispatchController],
  providers: [DispatchExpiryWorker, DispatchRepository, DispatchService],
})
export class DispatchModule {}
