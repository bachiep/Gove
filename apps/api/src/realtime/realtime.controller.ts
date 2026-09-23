import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticationGuard } from '../identity/authentication.guard.js';
import { Roles } from '../identity/roles.decorator.js';
import { RolesGuard } from '../identity/roles.guard.js';
import { RealtimeGateway } from './realtime.gateway.js';

@ApiTags('realtime')
@ApiBearerAuth()
@UseGuards(AuthenticationGuard, RolesGuard)
@Roles('OPERATOR')
@Controller('realtime')
export class RealtimeController {
  constructor(
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Read active real-time connection metrics' })
  metrics() {
    return this.realtime.getMetrics();
  }
}
