import {
  Body,
  Controller,
  Headers,
  Get,
  HttpStatus,
  Inject,
  Param,
  Post,
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
import {
  completeDeliverySchema,
  deliveryOfferParamsSchema,
  deliveryParamsSchema,
  pickupDeliverySchema,
} from './delivery.schemas.js';
import { DeliveryService } from './delivery.service.js';

@ApiTags('delivery-dispatch')
@ApiBearerAuth()
@UseGuards(AuthenticationGuard, RolesGuard)
@Roles('DRIVER')
@Controller()
export class DeliveryOfferController {
  constructor(
    @Inject(DeliveryService) private readonly deliveries: DeliveryService,
  ) {}

  @Get('delivery-offers/me')
  @ApiOperation({
    summary: 'List pending Delivery Offers for the current Driver',
  })
  pendingOffers(@CurrentActor() actor: SessionActor) {
    return this.deliveries.listPendingOffers(actor.id);
  }

  @Get('delivery-assignments/current')
  @ApiOperation({
    summary: 'Read the current assigned Delivery for the Driver',
  })
  currentAssignment(@CurrentActor() actor: SessionActor) {
    return this.deliveries.findCurrentForDriver(actor.id);
  }

  @Get('delivery-assignments/:deliveryId')
  @ApiOperation({ summary: 'Read one Driver-owned Delivery status projection' })
  findForDriver(@CurrentActor() actor: SessionActor, @Param() params: unknown) {
    return this.deliveries.findForDriver(
      actor.id,
      parseInput(deliveryParamsSchema, params).deliveryId,
    );
  }

  @Post('delivery-offers/:offerId/accept')
  @ApiOperation({ summary: 'Accept one pending Delivery Offer' })
  accept(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ) {
    if (
      !idempotencyKey ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 128
    )
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required.',
      );
    return this.deliveries.acceptOffer({
      driverUserId: actor.id,
      offerId: parseInput(deliveryOfferParamsSchema, params).offerId,
      idempotencyKey,
      correlationId,
    });
  }

  @Post('deliveries/:deliveryId/arrive')
  @ApiOperation({
    summary: 'Record assigned Driver arrival at Delivery Pickup',
  })
  arrive(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ) {
    return this.transition(
      actor,
      params,
      'ARRIVE_AT_PICKUP',
      idempotencyKey,
      correlationId,
    );
  }

  @Post('deliveries/:deliveryId/pickup')
  @ApiOperation({ summary: 'Record parcel custody at Delivery Pickup' })
  pickup(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ) {
    return this.transition(
      actor,
      params,
      'CONFIRM_PICKUP_CUSTODY',
      idempotencyKey,
      correlationId,
      parseInput(pickupDeliverySchema, body).custodyConfirmation,
    );
  }

  @Post('deliveries/:deliveryId/complete')
  @ApiOperation({ summary: 'Complete Delivery with recipient handoff proof' })
  complete(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ) {
    return this.transition(
      actor,
      params,
      'COMPLETE_DELIVERY',
      idempotencyKey,
      correlationId,
      parseInput(completeDeliverySchema, body).recipientProof,
    );
  }

  private transition(
    actor: SessionActor,
    params: unknown,
    action: 'ARRIVE_AT_PICKUP' | 'CONFIRM_PICKUP_CUSTODY' | 'COMPLETE_DELIVERY',
    idempotencyKey: string | undefined,
    correlationId: string | undefined,
    confirmation?: string,
  ) {
    if (
      !idempotencyKey ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 128
    )
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required.',
      );
    return this.deliveries.transitionAssignedDelivery({
      driverUserId: actor.id,
      deliveryId: parseInput(deliveryParamsSchema, params).deliveryId,
      action,
      idempotencyKey,
      correlationId,
      confirmation,
    });
  }
}
