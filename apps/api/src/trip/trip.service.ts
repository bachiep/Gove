import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { TripResponse } from '@gove/contracts';

import { ApiError } from '../common/http/api-error.js';
import { TripCommandError, TripRepository } from './trip.repository.js';

@Injectable()
export class TripService {
  constructor(
    @Inject(TripRepository) private readonly repository: TripRepository,
  ) {}

  async createTrip(input: {
    customerUserId: string;
    fareQuoteId: string;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<TripResponse> {
    try {
      return await this.repository.createTrip({
        ...input,
        correlationId: input.correlationId ?? randomUUID(),
        requestFingerprint: createHash('sha256')
          .update(JSON.stringify({ fareQuoteId: input.fareQuoteId }))
          .digest(),
      });
    } catch (error) {
      if (error instanceof TripCommandError) {
        const status =
          error.code === 'FARE_QUOTE_NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : error.code === 'FARE_QUOTE_EXPIRED'
              ? HttpStatus.UNPROCESSABLE_ENTITY
              : HttpStatus.CONFLICT;
        const message =
          error.code === 'FARE_QUOTE_NOT_FOUND'
            ? 'The Fare Quote was not found.'
            : error.code === 'FARE_QUOTE_EXPIRED'
              ? 'The Fare Quote has expired.'
              : error.code === 'FARE_QUOTE_ALREADY_CONSUMED'
                ? 'The Fare Quote was already used to create a Trip.'
                : 'The idempotency key was reused with a different request.';
        throw new ApiError(status, error.code, message);
      }
      throw error;
    }
  }
}
