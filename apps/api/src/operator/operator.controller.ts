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
import type {
  OperatorDiagnosticAuditResponse,
  OperatorTripDiagnosticTimelineResponse,
} from '@gove/contracts';

import { ApiError } from '../common/http/api-error.js';
import { parseInput } from '../common/http/validation.js';
import { AuthenticationGuard } from '../identity/authentication.guard.js';
import { CurrentActor } from '../identity/current-actor.decorator.js';
import type { SessionActor } from '../identity/identity.types.js';
import { Roles } from '../identity/roles.decorator.js';
import { RolesGuard } from '../identity/roles.guard.js';
import {
  approveOnboardingSubjectSchema,
  createDiagnosticAuditSchema,
  operatorDriverParamsSchema,
  operatorTripParamsSchema,
  operatorVehicleParamsSchema,
} from './operator.schemas.js';
import { OperatorService } from './operator.service.js';

@ApiTags('operator')
@ApiBearerAuth()
@UseGuards(AuthenticationGuard, RolesGuard)
@Roles('OPERATOR')
@Controller('operator')
export class OperatorController {
  constructor(
    @Inject(OperatorService) private readonly operator: OperatorService,
  ) {}

  @Get('trips/:tripId/timeline')
  @ApiOperation({
    summary: 'Read a PII-minimized diagnostic timeline for one Trip',
  })
  timeline(
    @Param() params: unknown,
  ): Promise<OperatorTripDiagnosticTimelineResponse> {
    return this.operator.getTripTimeline(
      parseInput(operatorTripParamsSchema, params).tripId,
    );
  }

  @Post('trips/:tripId/diagnostic-reviews')
  @ApiOperation({
    summary: 'Record an authorized Operator diagnostic review with a reason',
  })
  recordDiagnosticReview(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ): Promise<OperatorDiagnosticAuditResponse> {
    const tripId = parseInput(operatorTripParamsSchema, params).tripId;
    const { reason } = parseInput(createDiagnosticAuditSchema, body);
    return this.operator.recordDiagnosticReview({
      tripId,
      operatorUserId: actor.id,
      reason,
      correlationId: normalizeCorrelationId(correlationId),
    });
  }

  @Post('drivers/:driverUserId/approve')
  @ApiOperation({
    summary: 'Approve a pending Driver profile with an auditable reason',
  })
  approveDriver(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const { driverUserId } = parseInput(operatorDriverParamsSchema, params);
    const { reason } = parseInput(approveOnboardingSubjectSchema, body);
    return this.operator.approveDriver({
      driverUserId,
      operatorUserId: actor.id,
      reason,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Post('drivers/:driverUserId/reject')
  @ApiOperation({
    summary: 'Reject a pending Driver profile with an auditable reason',
  })
  rejectDriver(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const { driverUserId } = parseInput(operatorDriverParamsSchema, params);
    const { reason } = parseInput(approveOnboardingSubjectSchema, body);
    return this.operator.rejectDriver({
      driverUserId,
      operatorUserId: actor.id,
      reason,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Post('drivers/:driverUserId/vehicles/:vehicleId/approve')
  @ApiOperation({
    summary:
      'Approve and select a pending Driver Vehicle with an auditable reason',
  })
  approveVehicle(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const { driverUserId, vehicleId } = parseInput(
      operatorVehicleParamsSchema,
      params,
    );
    const { reason } = parseInput(approveOnboardingSubjectSchema, body);
    return this.operator.approveVehicle({
      driverUserId,
      vehicleId,
      operatorUserId: actor.id,
      reason,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }

  @Post('drivers/:driverUserId/vehicles/:vehicleId/reject')
  @ApiOperation({
    summary: 'Reject a pending Driver Vehicle with an auditable reason',
  })
  rejectVehicle(
    @CurrentActor() actor: SessionActor,
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const { driverUserId, vehicleId } = parseInput(
      operatorVehicleParamsSchema,
      params,
    );
    const { reason } = parseInput(approveOnboardingSubjectSchema, body);
    return this.operator.rejectVehicle({
      driverUserId,
      vehicleId,
      operatorUserId: actor.id,
      reason,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }
}

function requireIdempotencyKey(value: string | undefined): string {
  if (!value || value.length < 8 || value.length > 128) {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required.',
    );
  }
  return value;
}

function normalizeCorrelationId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > 128) {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'CORRELATION_ID_INVALID',
      'The correlation ID must contain at most 128 characters.',
    );
  }
  return normalized;
}
