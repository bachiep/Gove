import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Inject,
  Get,
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
import type { DeliveryResponse } from '@gove/contracts';

import { ApiError } from '../common/http/api-error.js';
import { parseInput } from '../common/http/validation.js';
import { AuthenticationGuard } from '../identity/authentication.guard.js';
import { CurrentActor } from '../identity/current-actor.decorator.js';
import type { SessionActor } from '../identity/identity.types.js';
import { Roles } from '../identity/roles.decorator.js';
import { RolesGuard } from '../identity/roles.guard.js';
import { createDeliverySchema } from './delivery.schemas.js';
import { deliveryParamsSchema } from './delivery.schemas.js';
import { DeliveryService } from './delivery.service.js';

@ApiTags('delivery')
@ApiBearerAuth()
@UseGuards(AuthenticationGuard, RolesGuard)
@Roles('CUSTOMER')
@Controller('deliveries')
export class DeliveryController {
  constructor(
    @Inject(DeliveryService) private readonly deliveries: DeliveryService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create one requested parcel Delivery' })
  @ApiCreatedResponse({ description: 'The Delivery was created or replayed' })
  async createDelivery(
    @CurrentActor() actor: SessionActor,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ): Promise<DeliveryResponse> {
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
    return this.deliveries.createDelivery({
      customerUserId: actor.id,
      idempotencyKey,
      correlationId,
      ...parseInput(createDeliverySchema, body),
    });
  }

  @Get(':deliveryId')
  @ApiOperation({ summary: 'Read one Customer-owned Delivery' })
  findForCustomer(
    @CurrentActor() actor: SessionActor,
    @Param('deliveryId') deliveryId: string,
  ): Promise<DeliveryResponse> {
    return this.deliveries.findForCustomer(actor.id, deliveryId);
  }

  @Post(':deliveryId/match')
  @ApiOperation({
    summary: 'Start one idempotent matching attempt for a Delivery',
  })
  match(
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
    return this.deliveries.startMatching({
      customerUserId: actor.id,
      deliveryId: parseInput(deliveryParamsSchema, params).deliveryId,
      idempotencyKey,
      correlationId,
    });
  }
}
