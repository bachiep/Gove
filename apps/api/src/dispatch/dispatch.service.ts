import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  ActiveTripResponse,
  DispatchMatchResponse,
  DispatchOfferRejectionResponse,
  TripDetailResponse,
  TripOfferResponse,
} from '@gove/contracts';

import { ApiError } from '../common/http/api-error.js';
import {
  DispatchCommandError,
  DispatchRepository,
  type WorkStateResponse,
} from './dispatch.repository.js';

@Injectable()
export class DispatchService {
  constructor(
    @Inject(DispatchRepository) private readonly repository: DispatchRepository,
  ) {}

  async setWorkState(
    driverUserId: string,
    state: 'AVAILABLE' | 'OFFLINE',
  ): Promise<WorkStateResponse> {
    try {
      return await this.repository.setWorkState(driverUserId, state);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async getWorkState(driverUserId: string): Promise<WorkStateResponse> {
    return this.repository.getWorkState(driverUserId);
  }

  async listPendingOffers(driverUserId: string): Promise<TripOfferResponse[]> {
    return this.repository.listPendingOffers(driverUserId);
  }

  async findCurrentAssignedTrip(
    driverUserId: string,
  ): Promise<ActiveTripResponse | null> {
    return this.repository.findCurrentAssignedTrip(driverUserId);
  }

  async startMatching(input: {
    customerUserId: string;
    tripId: string;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<DispatchMatchResponse> {
    try {
      return await this.repository.startMatching({
        ...input,
        requestFingerprint: createHash('sha256')
          .update(JSON.stringify({ tripId: input.tripId }))
          .digest(),
        correlationId: input.correlationId ?? randomUUID(),
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async acceptOffer(input: {
    driverUserId: string;
    offerId: string;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<TripOfferResponse> {
    try {
      const result = await this.repository.acceptOffer({
        ...input,
        requestFingerprint: createHash('sha256')
          .update(JSON.stringify({ offerId: input.offerId }))
          .digest(),
        correlationId: input.correlationId ?? randomUUID(),
      });
      if (!result.accepted) {
        throw new DispatchCommandError(result.code);
      }
      return result.response;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async rejectOffer(input: {
    driverUserId: string;
    offerId: string;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<DispatchOfferRejectionResponse> {
    try {
      const result = await this.repository.rejectOffer({
        ...input,
        requestFingerprint: createHash('sha256')
          .update(JSON.stringify({ offerId: input.offerId }))
          .digest(),
        correlationId: input.correlationId ?? randomUUID(),
      });
      if (!result.rejected) {
        throw new DispatchCommandError(result.code);
      }
      return result.response;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async transitionAssignedTrip(input: {
    driverUserId: string;
    tripId: string;
    action: 'ARRIVE_AT_PICKUP' | 'START_TRIP' | 'COMPLETE_TRIP';
    idempotencyKey: string;
    correlationId?: string;
    actualDistanceMeters?: number;
    actualDurationSeconds?: number;
  }): Promise<TripDetailResponse> {
    try {
      return await this.repository.transitionAssignedTrip({
        ...input,
        requestFingerprint: createHash('sha256')
          .update(
            JSON.stringify({
              tripId: input.tripId,
              actualDistanceMeters: input.actualDistanceMeters ?? null,
              actualDurationSeconds: input.actualDurationSeconds ?? null,
            }),
          )
          .digest(),
        correlationId: input.correlationId ?? randomUUID(),
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown): ApiError {
    if (!(error instanceof DispatchCommandError)) throw error;
    const status =
      error.code === 'TRIP_NOT_FOUND' ||
      error.code === 'TRIP_NOT_ASSIGNED_TO_DRIVER' ||
      error.code === 'OFFER_NOT_FOUND'
        ? HttpStatus.NOT_FOUND
        : error.code === 'DRIVER_NOT_ELIGIBLE'
          ? HttpStatus.UNPROCESSABLE_ENTITY
          : error.code === 'METERING_INVALID'
            ? HttpStatus.BAD_REQUEST
            : error.code === 'PRICING_SNAPSHOT_INVALID'
              ? HttpStatus.INTERNAL_SERVER_ERROR
              : HttpStatus.CONFLICT;
    const messages: Record<DispatchCommandError['code'], string> = {
      TRIP_NOT_FOUND: 'The Trip was not found for this Customer.',
      TRIP_NOT_MATCHABLE: 'The Trip is not available for matching.',
      DRIVER_NOT_ELIGIBLE:
        'Tài khoản Tài xế chưa đủ điều kiện để bật trạng thái nhận chuyến.',
      DRIVER_WORK_STATE_CONFLICT:
        'The Driver has an active operational commitment.',
      OFFER_NOT_FOUND: 'The Trip Offer was not found.',
      OFFER_NOT_FOR_DRIVER: 'The Trip Offer is not assigned to this Driver.',
      OFFER_EXPIRED: 'The Trip Offer has expired.',
      OFFER_ALREADY_RESOLVED: 'The Trip Offer has already been resolved.',
      TRIP_NOT_ASSIGNED_TO_DRIVER: 'The Driver is not assigned to this Trip.',
      TRIP_INVALID_STATE: 'The Trip is not ready for this Driver action.',
      METERING_INVALID:
        'Observed distance and duration must be positive integers.',
      PRICING_SNAPSHOT_INVALID:
        'The Trip pricing snapshot could not be evaluated.',
      IDEMPOTENCY_KEY_REUSED:
        'The idempotency key was reused with a different request.',
    };
    return new ApiError(status, error.code, messages[error.code]);
  }
}
