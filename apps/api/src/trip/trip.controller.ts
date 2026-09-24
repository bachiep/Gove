import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type {
  ActiveTripResponse,
  TripHistoryItem,
  TripResponse,
} from '@gove/contracts';

import { ApiError } from '../common/http/api-error.js';
import { parseInput } from '../common/http/validation.js';
import { AuthenticationGuard } from '../identity/authentication.guard.js';
import { CurrentActor } from '../identity/current-actor.decorator.js';
import type { SessionActor } from '../identity/identity.types.js';
import { Roles } from '../identity/roles.decorator.js';
import { RolesGuard } from '../identity/roles.guard.js';
import {
  cancelTripSchema,
  createTripSchema,
  tripParamsSchema,
} from './trip.schemas.js';
import { TripService } from './trip.service.js';

@ApiTags('trip')
@ApiBearerAuth()
@UseGuards(AuthenticationGuard, RolesGuard)
@Roles('CUSTOMER')
@Controller('trips')
export class TripController {
  constructor(@Inject(TripService) private readonly trips: TripService) {}

  @Post()
  @ApiOperation({
    summary: 'Create one requested Trip from an active Fare Quote',
  })
  @ApiCreatedResponse({
    description: 'The requested Trip was created or replayed',
  })
  async createTrip(
    @CurrentActor() actor: SessionActor,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ): Promise<TripResponse> {
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
    return this.trips.createTrip({
      customerUserId: actor.id,
      idempotencyKey,
      correlationId,
      ...parseInput(createTripSchema, body),
    });
  }

  @Post(':tripId/cancel')
  @ApiOperation({
    summary:
      'Cancel an eligible Customer-owned Trip without a cancellation fee',
  })
  async cancelTrip(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
    @Body() body: unknown,
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
    return this.trips.cancelTrip({
      customerUserId: actor.id,
      tripId: parseInput(tripParamsSchema, params).tripId,
      idempotencyKey,
      correlationId,
      ...parseInput(cancelTripSchema, body),
    });
  }

  @Get('history')
  @Roles('CUSTOMER', 'DRIVER')
  @ApiOperation({ summary: 'List the current actor Trip history' })
  history(@CurrentActor() actor: SessionActor): Promise<TripHistoryItem[]> {
    const role = actor.roles.includes('DRIVER') ? 'DRIVER' : 'CUSTOMER';
    return this.trips.listHistory(actor.id, role);
  }

  @Get('current')
  @ApiOperation({ summary: 'Read the current Customer active Trip' })
  current(
    @CurrentActor() actor: SessionActor,
  ): Promise<ActiveTripResponse | null> {
    return this.trips.findCurrentForCustomer(actor.id);
  }
}
