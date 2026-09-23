import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FareQuoteResponse } from '@gove/contracts';

import { ApiError } from '../common/http/api-error.js';
import { parseInput } from '../common/http/validation.js';
import { AuthenticationGuard } from '../identity/authentication.guard.js';
import { CurrentActor } from '../identity/current-actor.decorator.js';
import type { SessionActor } from '../identity/identity.types.js';
import { Roles } from '../identity/roles.decorator.js';
import { RolesGuard } from '../identity/roles.guard.js';
import { PricingService } from './pricing.service.js';
import { createFareQuoteSchema } from './pricing.schemas.js';

@ApiTags('pricing')
@ApiBearerAuth()
@UseGuards(AuthenticationGuard, RolesGuard)
@Roles('CUSTOMER')
@Controller('pricing')
export class PricingController {
  constructor(
    @Inject(PricingService) private readonly pricing: PricingService,
  ) {}

  @Post('fare-quotes')
  @ApiOperation({
    summary: 'Create an expiring Fare Quote for the current Customer',
  })
  @ApiCreatedResponse({ description: 'The Fare Quote was created or replayed' })
  async createFareQuote(
    @CurrentActor() actor: SessionActor,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<FareQuoteResponse> {
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
    return this.pricing.createFareQuote({
      customerUserId: actor.id,
      idempotencyKey,
      ...parseInput(createFareQuoteSchema, body),
    });
  }
}
