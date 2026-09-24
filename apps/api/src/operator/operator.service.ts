import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  OperatorDiagnosticAuditResponse,
  OperatorTripDiagnosticTimelineResponse,
} from '@gove/contracts';

import { ApiError } from '../common/http/api-error.js';
import {
  OperatorCommandError,
  OperatorRepository,
} from './operator.repository.js';

@Injectable()
export class OperatorService {
  constructor(
    @Inject(OperatorRepository)
    private readonly repository: OperatorRepository,
  ) {}

  async getTripTimeline(
    tripId: string,
  ): Promise<OperatorTripDiagnosticTimelineResponse> {
    const timeline = await this.repository.getTripTimeline(tripId);
    if (!timeline) throw tripNotFound();
    return timeline;
  }

  async recordDiagnosticReview(input: {
    tripId: string;
    operatorUserId: string;
    reason: string;
    correlationId?: string;
  }): Promise<OperatorDiagnosticAuditResponse> {
    const audit = await this.repository.createDiagnosticAudit({
      ...input,
      correlationId: input.correlationId ?? randomUUID(),
    });
    if (!audit) throw tripNotFound();
    return audit;
  }

  async approveDriver(input: {
    driverUserId: string;
    operatorUserId: string;
    reason: string;
    idempotencyKey: string;
  }) {
    const result = await this.reviewDriver(input, 'APPROVED');
    if (result.kind === 'REVIEWED') return result.approval;
    if (result.kind === 'NOT_FOUND') throw driverNotFound();
    if (result.kind === 'PROFILE_INCOMPLETE') {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'DRIVER_PROFILE_INCOMPLETE',
        'The Driver profile must include a phone number before approval.',
      );
    }
    throw onboardingNotPending('Driver profile');
  }

  async rejectDriver(input: {
    driverUserId: string;
    operatorUserId: string;
    reason: string;
    idempotencyKey: string;
  }) {
    const result = await this.reviewDriver(input, 'REJECTED');
    if (result.kind === 'REVIEWED') return result.approval;
    if (result.kind === 'NOT_FOUND') throw driverNotFound();
    throw onboardingNotPending('Driver profile');
  }

  async approveVehicle(input: {
    driverUserId: string;
    vehicleId: string;
    operatorUserId: string;
    reason: string;
    idempotencyKey: string;
  }) {
    const result = await this.reviewVehicle(input, 'APPROVED');
    if (result.kind === 'REVIEWED') return result.approval;
    if (result.kind === 'DRIVER_NOT_FOUND') throw driverNotFound();
    if (result.kind === 'VEHICLE_NOT_FOUND') {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        'VEHICLE_NOT_FOUND',
        'The Vehicle was not found for this Driver.',
      );
    }
    if (result.kind === 'DRIVER_NOT_APPROVED') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'DRIVER_PROFILE_NOT_APPROVED',
        'Approve the Driver profile before approving a Vehicle.',
      );
    }
    throw onboardingNotPending('Vehicle');
  }

  async rejectVehicle(input: {
    driverUserId: string;
    vehicleId: string;
    operatorUserId: string;
    reason: string;
    idempotencyKey: string;
  }) {
    const result = await this.reviewVehicle(input, 'REJECTED');
    if (result.kind === 'REVIEWED') return result.approval;
    if (result.kind === 'DRIVER_NOT_FOUND') throw driverNotFound();
    if (result.kind === 'VEHICLE_NOT_FOUND') {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        'VEHICLE_NOT_FOUND',
        'The Vehicle was not found for this Driver.',
      );
    }
    throw onboardingNotPending('Vehicle');
  }

  private async reviewDriver(
    input: Parameters<OperatorService['approveDriver']>[0],
    resultingStatus: 'APPROVED' | 'REJECTED',
  ) {
    try {
      return await this.repository.reviewDriver({
        ...input,
        resultingStatus,
        operation:
          resultingStatus === 'APPROVED' ? 'APPROVE_DRIVER' : 'REJECT_DRIVER',
        requestFingerprint: fingerprint({
          driverUserId: input.driverUserId,
          reason: input.reason,
          resultingStatus,
        }),
      });
    } catch (error) {
      if (error instanceof OperatorCommandError) {
        throw idempotencyKeyReused();
      }
      throw error;
    }
  }

  private async reviewVehicle(
    input: Parameters<OperatorService['approveVehicle']>[0],
    resultingStatus: 'APPROVED' | 'REJECTED',
  ) {
    try {
      return await this.repository.reviewVehicle({
        ...input,
        resultingStatus,
        operation:
          resultingStatus === 'APPROVED' ? 'APPROVE_VEHICLE' : 'REJECT_VEHICLE',
        requestFingerprint: fingerprint({
          driverUserId: input.driverUserId,
          vehicleId: input.vehicleId,
          reason: input.reason,
          resultingStatus,
        }),
      });
    } catch (error) {
      if (error instanceof OperatorCommandError) {
        throw idempotencyKeyReused();
      }
      throw error;
    }
  }
}

function fingerprint(value: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(value)).digest();
}

function idempotencyKeyReused(): ApiError {
  return new ApiError(
    HttpStatus.CONFLICT,
    'IDEMPOTENCY_KEY_REUSED',
    'The idempotency key was reused with a different request.',
  );
}

function tripNotFound(): ApiError {
  return new ApiError(
    HttpStatus.NOT_FOUND,
    'TRIP_NOT_FOUND',
    'The requested Trip was not found.',
  );
}

function driverNotFound(): ApiError {
  return new ApiError(
    HttpStatus.NOT_FOUND,
    'DRIVER_PROFILE_NOT_FOUND',
    'The Driver profile was not found.',
  );
}

function onboardingNotPending(subject: string): ApiError {
  return new ApiError(
    HttpStatus.CONFLICT,
    'ONBOARDING_SUBJECT_NOT_PENDING',
    `${subject} is not pending approval.`,
  );
}
