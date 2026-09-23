import { Body, Controller, Inject, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { parseInput } from '../common/http/validation.js';
import { AuthenticationGuard } from '../identity/authentication.guard.js';
import { CurrentActor } from '../identity/current-actor.decorator.js';
import type { SessionActor } from '../identity/identity.types.js';
import { Roles } from '../identity/roles.decorator.js';
import { RolesGuard } from '../identity/roles.guard.js';
import { LocationService } from './location.service.js';
import { latestLocationSchema } from './location.schemas.js';

@ApiTags('location')
@ApiBearerAuth()
@UseGuards(AuthenticationGuard, RolesGuard)
@Roles('DRIVER')
@Controller('drivers/me/location')
export class LocationController {
  constructor(
    @Inject(LocationService) private readonly locations: LocationService,
  ) {}

  @Put()
  @ApiOperation({ summary: 'Record the current Driver latest location' })
  update(@CurrentActor() actor: SessionActor, @Body() body: unknown) {
    return this.locations.updateLatest(
      actor.id,
      parseInput(latestLocationSchema, body),
    );
  }
}
