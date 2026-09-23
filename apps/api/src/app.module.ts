import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module.js';
import { DriverModule } from './driver/driver.module.js';
import { HealthController } from './health/health.controller.js';
import { IdentityModule } from './identity/identity.module.js';

@Module({
  imports: [DatabaseModule, IdentityModule, DriverModule],
  controllers: [HealthController],
})
export class AppModule {}
