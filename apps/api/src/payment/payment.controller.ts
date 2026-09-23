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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PaymentAttemptResponse } from '@gove/contracts';

import { ApiError } from '../common/http/api-error.js';
import { parseInput } from '../common/http/validation.js';
import { AuthenticationGuard } from '../identity/authentication.guard.js';
import { CurrentActor } from '../identity/current-actor.decorator.js';
import type { SessionActor } from '../identity/identity.types.js';
import { Roles } from '../identity/roles.decorator.js';
import { RolesGuard } from '../identity/roles.guard.js';
import {
  capturePaymentSchema,
  paymentTripParamsSchema,
} from './payment.schemas.js';
import { PaymentService } from './payment.service.js';

@ApiTags('payment')
@ApiBearerAuth()
@UseGuards(AuthenticationGuard, RolesGuard)
@Controller('payments')
export class PaymentController {
  constructor(
    @Inject(PaymentService) private readonly payments: PaymentService,
  ) {}

  @Post('trips/:tripId/capture')
  @Roles('CUSTOMER')
  @ApiOperation({ summary: 'Capture the final Fare through the simulator' })
  async capture(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ): Promise<PaymentAttemptResponse> {
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
    const input = parseInput(capturePaymentSchema, body ?? {});
    return this.payments.capture({
      customerUserId: actor.id,
      tripId: parseInput(paymentTripParamsSchema, params).tripId,
      idempotencyKey,
      correlationId,
      simulationOutcome: input.simulationOutcome,
    });
  }

  @Get('trips/:tripId')
  @Roles('CUSTOMER', 'DRIVER', 'OPERATOR')
  @ApiOperation({ summary: 'Read the latest Payment Attempt for a Trip' })
  getForTrip(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
  ): Promise<PaymentAttemptResponse> {
    return this.payments.findForActor({
      actorId: actor.id,
      actorRoles: actor.roles,
      tripId: parseInput(paymentTripParamsSchema, params).tripId,
    });
  }
}
