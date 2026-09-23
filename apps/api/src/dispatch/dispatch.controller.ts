import {
  Body,
  Controller,
  Get,
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
import type { TripDetailResponse, TripOfferResponse } from '@gove/contracts';
import { DispatchService } from './dispatch.service.js';
import {
  dispatchOfferParamsSchema,
  dispatchTripParamsSchema,
  completeTripSchema,
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

  @Get('drivers/me/work-state')
  @Roles('DRIVER')
  @ApiOperation({ summary: 'Read the current Driver availability work state' })
  workStateRead(@CurrentActor() actor: SessionActor) {
    return this.dispatch.getWorkState(actor.id);
  }

  @Get('dispatch/offers/me')
  @Roles('DRIVER')
  @ApiOperation({ summary: 'List pending Trip Offers for the current Driver' })
  pendingOffers(
    @CurrentActor() actor: SessionActor,
  ): Promise<TripOfferResponse[]> {
    return this.dispatch.listPendingOffers(actor.id);
  }

  @Get('dispatch/trips/current')
  @Roles('DRIVER')
  @ApiOperation({ summary: 'Read the current assigned Trip for the Driver' })
  currentTrip(
    @CurrentActor() actor: SessionActor,
  ): Promise<TripDetailResponse | null> {
    return this.dispatch.findCurrentAssignedTrip(actor.id);
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

  @Post('dispatch/offers/:offerId/reject')
  @Roles('DRIVER')
  @ApiOperation({ summary: 'Reject one pending Trip Offer' })
  async rejectOffer(
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
    return this.dispatch.rejectOffer({
      driverUserId: actor.id,
      offerId: parseInput(dispatchOfferParamsSchema, params).offerId,
      idempotencyKey,
      correlationId,
    });
  }

  @Post('dispatch/trips/:tripId/arrive')
  @Roles('DRIVER')
  @ApiOperation({ summary: 'Record that the assigned Driver reached Pickup' })
  arriveAtPickup(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ) {
    return this.transitionAssignedTrip({
      actor,
      params,
      action: 'ARRIVE_AT_PICKUP',
      idempotencyKey,
      correlationId,
    });
  }

  @Post('dispatch/trips/:tripId/start')
  @Roles('DRIVER')
  @ApiOperation({ summary: 'Start the assigned Trip after Pickup' })
  startTrip(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ) {
    return this.transitionAssignedTrip({
      actor,
      params,
      action: 'START_TRIP',
      idempotencyKey,
      correlationId,
    });
  }

  @Post('dispatch/trips/:tripId/complete')
  @Roles('DRIVER')
  @ApiOperation({
    summary: 'Complete the assigned Trip with observed metering',
  })
  completeTrip(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ) {
    const input = parseInput(completeTripSchema, body);
    return this.transitionAssignedTrip({
      actor,
      params,
      action: 'COMPLETE_TRIP',
      idempotencyKey,
      correlationId,
      actualDistanceMeters: input.actualDistanceMeters,
      actualDurationSeconds: input.actualDurationSeconds,
    });
  }

  private transitionAssignedTrip(input: {
    actor: SessionActor;
    params: unknown;
    action: 'ARRIVE_AT_PICKUP' | 'START_TRIP' | 'COMPLETE_TRIP';
    idempotencyKey: string | undefined;
    correlationId: string | undefined;
    actualDistanceMeters?: number;
    actualDurationSeconds?: number;
  }) {
    if (
      !input.idempotencyKey ||
      input.idempotencyKey.length < 8 ||
      input.idempotencyKey.length > 128
    ) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required.',
      );
    }
    return this.dispatch.transitionAssignedTrip({
      driverUserId: input.actor.id,
      tripId: parseInput(dispatchTripParamsSchema, input.params).tripId,
      action: input.action,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
      actualDistanceMeters: input.actualDistanceMeters,
      actualDurationSeconds: input.actualDurationSeconds,
    });
  }
}
