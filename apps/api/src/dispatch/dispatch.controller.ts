import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiError } from '../common/http/api-error.js';
import { parseInput } from '../common/http/validation.js';
import { AuthenticationGuard } from '../identity/authentication.guard.js';
import { CurrentActor } from '../identity/current-actor.decorator.js';
import type { SessionActor } from '../identity/identity.types.js';
import { Roles } from '../identity/roles.decorator.js';
import { RolesGuard } from '../identity/roles.guard.js';
import { DispatchService } from './dispatch.service.js';
import {
  dispatchOfferParamsSchema,
  dispatchTripParamsSchema,
  driverWorkStateSchema,
} from './dispatch.schemas.js';

@ApiTags('dispatch')
@ApiBearerAuth()
@UseGuards(AuthenticationGuard, RolesGuard)
@Controller()
export class DispatchController {
  constructor(
    @Inject(DispatchService) private readonly dispatch: DispatchService,
  ) {}

  @Put('drivers/me/work-state')
  @Roles('DRIVER')
  @ApiOperation({ summary: 'Set the current Driver availability work state' })
  workState(@CurrentActor() actor: SessionActor, @Body() body: unknown) {
    return this.dispatch.setWorkState(
      actor.id,
      parseInput(driverWorkStateSchema, body).state,
    );
  }

  @Post('dispatch/trips/:tripId/match')
  @Roles('CUSTOMER')
  @ApiOperation({
    summary: 'Start one idempotent matching attempt for a Customer Trip',
  })
  matchTrip(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ) {
    if (
      !idempotencyKey ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 128
    ) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required.',
      );
    }
    return this.dispatch.startMatching({
      customerUserId: actor.id,
      tripId: parseInput(dispatchTripParamsSchema, params).tripId,
      idempotencyKey,
      correlationId,
    });
  }

  @Post('dispatch/offers/:offerId/accept')
  @Roles('DRIVER')
  @ApiOperation({ summary: 'Accept one pending Trip Offer' })
  async acceptOffer(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ) {
    if (
      !idempotencyKey ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 128
    ) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required.',
      );
    }
    return this.dispatch.acceptOffer({
      driverUserId: actor.id,
      offerId: parseInput(dispatchOfferParamsSchema, params).offerId,
      idempotencyKey,
      correlationId,
    });
  }
}
