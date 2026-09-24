import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  PaymentAttemptResponse,
  PaymentProvider,
  PaymentStatus,
} from '@gove/contracts';

import { ApiError } from '../common/http/api-error.js';
import {
  PaymentCommandError,
  PaymentRepository,
} from './payment.repository.js';
import { PaymentProviderRegistry } from './payment-provider.js';

@Injectable()
export class PaymentService {
  constructor(
    @Inject(PaymentRepository) private readonly repository: PaymentRepository,
    @Inject(PaymentProviderRegistry)
    private readonly providers: PaymentProviderRegistry,
  ) {}

  async capture(input: {
    customerUserId: string;
    tripId: string;
    idempotencyKey: string;
    correlationId?: string;
    provider: PaymentProvider;
    simulationOutcome?: PaymentStatus;
  }): Promise<PaymentAttemptResponse> {
    try {
      const plan = this.providers.planCapture({
        provider: input.provider,
        simulationOutcome: input.simulationOutcome,
      });
      return await this.repository.capture({
        ...input,
        ...plan,
        requestFingerprint: createHash('sha256')
          .update(
            JSON.stringify({
              tripId: input.tripId,
              provider: plan.provider,
              simulationOutcome: input.simulationOutcome,
            }),
          )
          .digest(),
        correlationId: input.correlationId ?? randomUUID(),
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async findForActor(input: {
    actorId: string;
    actorRoles: readonly string[];
    tripId: string;
  }): Promise<PaymentAttemptResponse> {
    try {
      return await this.repository.findForActor(input);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown): ApiError {
    if (!(error instanceof PaymentCommandError)) throw error;
    const status =
      error.code === 'TRIP_NOT_FOUND' || error.code === 'PAYMENT_NOT_FOUND'
        ? HttpStatus.NOT_FOUND
        : error.code === 'PAYMENT_FORBIDDEN'
          ? HttpStatus.FORBIDDEN
          : HttpStatus.CONFLICT;
    const messages: Record<PaymentCommandError['code'], string> = {
      TRIP_NOT_FOUND: 'The Trip was not found.',
      PAYMENT_FORBIDDEN: 'You do not own this Payment resource.',
      TRIP_NOT_COMPLETED: 'Payment requires a completed Trip.',
      PAYMENT_NOT_FOUND: 'No Payment Attempt exists for this Trip.',
      PAYMENT_PENDING: 'A Payment Attempt is still pending.',
      PAYMENT_ALREADY_SUCCEEDED: 'The Trip has already been paid.',
      PAYMENT_RECONCILIATION_REQUIRED:
        'The Payment outcome is unknown and must be reconciled before retrying.',
      IDEMPOTENCY_KEY_REUSED:
        'The idempotency key was reused with a different request.',
    };
    return new ApiError(status, error.code, messages[error.code]);
  }
}
