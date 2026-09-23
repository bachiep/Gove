import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module.js';
import { DriverController } from './driver.controller.js';
import { DriverRepository } from './driver.repository.js';
import { DriverService } from './driver.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [DriverController],
  providers: [DriverRepository, DriverService],
})
export class DriverModule {}
