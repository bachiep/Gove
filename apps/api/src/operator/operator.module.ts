import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OperatorController } from './operator.controller.js';
import { OperatorRepository } from './operator.repository.js';
import { OperatorService } from './operator.service.js';

@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [OperatorController],
  providers: [OperatorRepository, OperatorService],
})
export class OperatorModule {}
