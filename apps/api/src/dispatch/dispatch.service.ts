import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { DispatchMatchResponse, TripOfferResponse } from '@gove/contracts';

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

  private mapError(error: unknown): ApiError {
    if (!(error instanceof DispatchCommandError)) throw error;
    const status =
      error.code === 'TRIP_NOT_FOUND' || error.code === 'OFFER_NOT_FOUND'
        ? HttpStatus.NOT_FOUND
        : error.code === 'DRIVER_NOT_ELIGIBLE'
          ? HttpStatus.UNPROCESSABLE_ENTITY
          : HttpStatus.CONFLICT;
    const messages: Record<DispatchCommandError['code'], string> = {
      TRIP_NOT_FOUND: 'The Trip was not found for this Customer.',
      TRIP_NOT_MATCHABLE: 'The Trip is not available for matching.',
      DRIVER_NOT_ELIGIBLE: 'The Driver is not eligible to go online.',
      DRIVER_WORK_STATE_CONFLICT:
        'The Driver has an active operational commitment.',
      OFFER_NOT_FOUND: 'The Trip Offer was not found.',
      OFFER_NOT_FOR_DRIVER: 'The Trip Offer is not assigned to this Driver.',
      OFFER_EXPIRED: 'The Trip Offer has expired.',
      OFFER_ALREADY_RESOLVED: 'The Trip Offer has already been resolved.',
      IDEMPOTENCY_KEY_REUSED:
        'The idempotency key was reused with a different request.',
    };
    return new ApiError(status, error.code, messages[error.code]);
  }
}
