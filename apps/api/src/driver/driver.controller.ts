import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { parseInput } from '../common/http/validation.js';
import { AuthenticationGuard } from '../identity/authentication.guard.js';
import { CurrentActor } from '../identity/current-actor.decorator.js';
import type { SessionActor } from '../identity/identity.types.js';
import { RolesGuard } from '../identity/roles.guard.js';
import { Roles } from '../identity/roles.decorator.js';
import { DriverService } from './driver.service.js';
import { createVehicleSchema, driverProfileSchema } from './driver.schemas.js';

@ApiTags('driver')
@ApiBearerAuth()
@UseGuards(AuthenticationGuard, RolesGuard)
@Roles('DRIVER')
@Controller('drivers/me')
export class DriverController {
  constructor(@Inject(DriverService) private readonly drivers: DriverService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Read the current Driver profile' })
  profile(@CurrentActor() actor: SessionActor) {
    return this.drivers.getProfile(actor.id);
  }

  @Put('profile')
  @ApiOperation({ summary: 'Update the current Driver profile' })
  updateProfile(@CurrentActor() actor: SessionActor, @Body() body: unknown) {
    return this.drivers.updateProfile(
      actor.id,
      parseInput(driverProfileSchema, body),
    );
  }

  @Post('vehicles')
  @ApiOperation({ summary: 'Add a Vehicle owned by the current Driver' })
  createVehicle(@CurrentActor() actor: SessionActor, @Body() body: unknown) {
    return this.drivers.createVehicle(
      actor.id,
      parseInput(createVehicleSchema, body),
    );
  }

  @Get('vehicles')
  @ApiOperation({ summary: 'List current non-retired Driver Vehicles' })
  vehicles(@CurrentActor() actor: SessionActor) {
    return this.drivers.listVehicles(actor.id);
  }

  @Delete('vehicles/:vehicleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retire a Vehicle owned by the current Driver' })
  async retireVehicle(
    @CurrentActor() actor: SessionActor,
    @Param('vehicleId') vehicleId: string,
  ): Promise<void> {
    await this.drivers.retireVehicle(actor.id, vehicleId);
  }

  @Get('eligibility')
  @ApiOkResponse({ description: 'The current Driver eligibility projection' })
  @ApiOperation({ summary: 'Read the current Driver eligibility projection' })
  eligibility(@CurrentActor() actor: SessionActor) {
    return this.drivers.eligibility(actor.id);
  }
}
