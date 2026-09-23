import {
  Controller,
  Headers,
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
import { deliveryOfferParamsSchema } from './delivery.schemas.js';
import { DeliveryService } from './delivery.service.js';

@ApiTags('delivery-dispatch')
@ApiBearerAuth()
@UseGuards(AuthenticationGuard, RolesGuard)
@Roles('DRIVER')
@Controller('delivery-offers')
export class DeliveryOfferController {
  constructor(
    @Inject(DeliveryService) private readonly deliveries: DeliveryService,
  ) {}

  @Post(':offerId/accept')
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
}
