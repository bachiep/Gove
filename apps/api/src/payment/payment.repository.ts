import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { PaymentAttemptResponse, PaymentStatus } from '@gove/contracts';
import type { QueryResultRow } from 'pg';

import {
  DatabaseService,
  type DatabaseExecutor,
} from '../database/database.service.js';

interface PaymentAttemptRow extends QueryResultRow {
  id: string;
  trip_id: string;
  attempt_number: number;
  amount_minor: string;
  currency: string;
  status: PaymentStatus;
  provider_reference: string | null;
  failure_code: string | null;
  requested_at: Date;
  resolved_at: Date | null;
}

export type PaymentCommandErrorCode =
  | 'TRIP_NOT_FOUND'
  | 'PAYMENT_FORBIDDEN'
  | 'TRIP_NOT_COMPLETED'
  | 'PAYMENT_NOT_FOUND'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_ALREADY_SUCCEEDED'
  | 'PAYMENT_RECONCILIATION_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED';

export class PaymentCommandError extends Error {
  constructor(readonly code: PaymentCommandErrorCode) {
    super(code);
  }
}

@Injectable()
export class PaymentRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async capture(input: {
    customerUserId: string;
    tripId: string;
    idempotencyKey: string;
    requestFingerprint: Buffer;
    correlationId: string;
    simulationOutcome: PaymentStatus;
  }): Promise<PaymentAttemptResponse> {
    return this.database.transaction(async (executor) => {
      await executor.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.customerUserId}:capture-payment:${input.idempotencyKey}`,
      ]);

      const receiptResult = await executor.query<{
        request_fingerprint: Buffer;
        response_body: PaymentAttemptResponse;
      }>(
        `SELECT request_fingerprint, response_body
         FROM payment.command_receipts
         WHERE actor_user_id = $1 AND operation = 'CAPTURE_PAYMENT'
           AND idempotency_key = $2
         FOR UPDATE`,
        [input.customerUserId, input.idempotencyKey],
      );
      const receipt = receiptResult.rows[0];
      if (receipt) {
        if (
          !sameDigest(receipt.request_fingerprint, input.requestFingerprint)
        ) {
          throw new PaymentCommandError('IDEMPOTENCY_KEY_REUSED');
        }
        return receipt.response_body;
      }

      const tripResult = await executor.query<{
        id: string;
        customer_user_id: string;
        state: string;
        final_fare_minor: string | null;
        currency: string;
      }>(
        `SELECT id, customer_user_id, state, final_fare_minor, currency
         FROM trip.trips
         WHERE id = $1
         FOR UPDATE`,
        [input.tripId],
      );
      const trip = tripResult.rows[0];
      if (!trip) throw new PaymentCommandError('TRIP_NOT_FOUND');
      if (trip.customer_user_id !== input.customerUserId) {
        throw new PaymentCommandError('PAYMENT_FORBIDDEN');
      }
      if (trip.state !== 'COMPLETED' || trip.final_fare_minor === null) {
        throw new PaymentCommandError('TRIP_NOT_COMPLETED');
      }

      const latestResult = await executor.query<PaymentAttemptRow>(
        `SELECT id, trip_id, attempt_number, amount_minor, currency, status,
                provider_reference, failure_code, requested_at, resolved_at
         FROM payment.payment_attempts
         WHERE trip_id = $1
         ORDER BY attempt_number DESC
         LIMIT 1
         FOR UPDATE`,
        [input.tripId],
      );
      const latest = latestResult.rows[0];
      if (latest?.status === 'PENDING') {
        throw new PaymentCommandError('PAYMENT_PENDING');
      }
      if (latest?.status === 'SUCCEEDED') {
        throw new PaymentCommandError('PAYMENT_ALREADY_SUCCEEDED');
      }
      if (latest?.status === 'UNKNOWN') {
        throw new PaymentCommandError('PAYMENT_RECONCILIATION_REQUIRED');
      }

      const attemptId = randomUUID();
      const attemptNumber = (latest?.attempt_number ?? 0) + 1;
      const providerReference =
        input.simulationOutcome === 'SUCCEEDED' ? `sim-${randomUUID()}` : null;
      const failureCode =
        input.simulationOutcome === 'FAILED'
          ? 'SIMULATED_FAILURE'
          : input.simulationOutcome === 'UNKNOWN'
            ? 'SIMULATED_TIMEOUT'
            : null;
      const attemptResult = await executor.query<PaymentAttemptRow>(
        `INSERT INTO payment.payment_attempts (
           id, trip_id, customer_user_id, attempt_number, amount_minor,
           currency, status, provider_reference, failure_code, resolved_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                   CASE WHEN $7 = 'PENDING' THEN NULL ELSE now() END)
         RETURNING id, trip_id, attempt_number, amount_minor, currency, status,
                   provider_reference, failure_code, requested_at, resolved_at`,
        [
          attemptId,
          input.tripId,
          input.customerUserId,
          attemptNumber,
          trip.final_fare_minor,
          trip.currency,
          input.simulationOutcome,
          providerReference,
          failureCode,
        ],
      );
      const attempt = attemptResult.rows[0] as PaymentAttemptRow;
      const response = toPaymentAttemptResponse(attempt);

      await executor.query(
        `INSERT INTO payment.outbox_events (
           id, payment_attempt_id, trip_id, event_type, payload
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          randomUUID(),
          attempt.id,
          input.tripId,
          `payment.${input.simulationOutcome.toLowerCase()}`,
          JSON.stringify({
            tripId: input.tripId,
            paymentAttemptId: attempt.id,
            attemptNumber,
            status: input.simulationOutcome,
            amountMinor: Number(trip.final_fare_minor),
            currency: trip.currency,
            correlationId: input.correlationId,
          }),
        ],
      );
      await persistCaptureReceipt(executor, {
        actorUserId: input.customerUserId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        response,
        paymentAttemptId: attempt.id,
        tripId: input.tripId,
      });
      return response;
    });
  }

  async findForActor(input: {
    actorId: string;
    actorRoles: readonly string[];
    tripId: string;
  }): Promise<PaymentAttemptResponse> {
    const result = await this.database.query<PaymentAttemptRow>(
      `SELECT p.id, p.trip_id, p.attempt_number, p.amount_minor, p.currency,
              p.status, p.provider_reference, p.failure_code,
              p.requested_at, p.resolved_at
       FROM payment.payment_attempts p
       JOIN trip.trips t ON t.id = p.trip_id
       LEFT JOIN dispatch.assignments a ON a.trip_id = p.trip_id
       WHERE p.trip_id = $1
         AND ($2 = t.customer_user_id OR $2 = a.driver_user_id OR $3 = true)
       ORDER BY p.attempt_number DESC
       LIMIT 1`,
      [input.tripId, input.actorId, input.actorRoles.includes('OPERATOR')],
    );
    const attempt = result.rows[0];
    if (!attempt) throw new PaymentCommandError('PAYMENT_NOT_FOUND');
    return toPaymentAttemptResponse(attempt);
  }
}

function sameDigest(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}

function toPaymentAttemptResponse(
  row: PaymentAttemptRow,
): PaymentAttemptResponse {
  return {
    id: row.id,
    tripId: row.trip_id,
    attemptNumber: row.attempt_number,
    amountMinor: safeInteger(row.amount_minor, 'amount_minor'),
    currency: row.currency,
    status: row.status,
    providerReference: row.provider_reference,
    failureCode: row.failure_code,
    requestedAt: row.requested_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
  };
}

function safeInteger(value: string, column: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${column} is not a non-negative safe integer`);
  }
  return parsed;
}

async function persistCaptureReceipt(
  executor: DatabaseExecutor,
  input: {
    actorUserId: string;
    idempotencyKey: string;
    requestFingerprint: Buffer;
    response: PaymentAttemptResponse;
    paymentAttemptId: string;
    tripId: string;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO payment.command_receipts (
       actor_user_id, operation, idempotency_key, request_fingerprint,
       response_body, payment_attempt_id, trip_id
     ) VALUES ($1, 'CAPTURE_PAYMENT', $2, $3, $4, $5, $6)`,
    [
      input.actorUserId,
      input.idempotencyKey,
      input.requestFingerprint,
      JSON.stringify(input.response),
      input.paymentAttemptId,
      input.tripId,
    ],
  );
}
