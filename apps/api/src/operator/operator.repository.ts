import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type {
  OperatorDiagnosticAuditResponse,
  OperatorTripDiagnosticTimelineResponse,
  TripState,
} from '@gove/contracts';
import type { QueryResultRow } from 'pg';

import {
  type DatabaseExecutor,
  DatabaseService,
} from '../database/database.service.js';

interface TripDiagnosticRow extends QueryResultRow {
  id: string;
  state: TripState;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface TransitionRow extends QueryResultRow {
  command: string;
  from_state: TripState | null;
  to_state: TripState;
  from_version: number | null;
  to_version: number;
  correlation_id: string;
  created_at: Date;
}

interface AuditSummaryRow extends QueryResultRow {
  id: string;
  action: 'DIAGNOSTIC_REVIEW';
  correlation_id: string;
  created_at: Date;
}

interface AuditRow extends AuditSummaryRow {
  reason: string;
}

interface DriverProfileApprovalRow extends QueryResultRow {
  user_id: string;
  phone: string | null;
  approval_status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
}

interface VehicleApprovalRow extends QueryResultRow {
  id: string;
  approval_status:
    'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'RETIRED';
}

interface ApprovalActionRow extends QueryResultRow {
  id: string;
  subject_type: 'DRIVER_PROFILE' | 'VEHICLE';
  driver_user_id: string;
  vehicle_id: string | null;
  previous_status: string;
  resulting_status: 'APPROVED' | 'REJECTED';
  reason: string;
  operator_user_id: string;
  created_at: Date;
}

export interface OnboardingApproval {
  id: string;
  subjectType: 'DRIVER_PROFILE' | 'VEHICLE';
  driverUserId: string;
  vehicleId: string | null;
  previousStatus: string;
  resultingStatus: 'APPROVED' | 'REJECTED';
  reason: string;
  reviewedByUserId: string;
  reviewedAt: string;
}

type DriverApprovalResult =
  | { kind: 'REVIEWED'; approval: OnboardingApproval }
  | { kind: 'NOT_FOUND' }
  | { kind: 'PROFILE_INCOMPLETE' }
  | { kind: 'NOT_PENDING' };

type VehicleApprovalResult =
  | { kind: 'REVIEWED'; approval: OnboardingApproval }
  | { kind: 'DRIVER_NOT_FOUND' }
  | { kind: 'VEHICLE_NOT_FOUND' }
  | { kind: 'DRIVER_NOT_APPROVED' }
  | { kind: 'NOT_PENDING' };

export type OnboardingReviewOperation =
  'APPROVE_DRIVER' | 'REJECT_DRIVER' | 'APPROVE_VEHICLE' | 'REJECT_VEHICLE';

export class OperatorCommandError extends Error {
  constructor(readonly code: 'IDEMPOTENCY_KEY_REUSED') {
    super(code);
  }
}

interface OnboardingReceiptRow extends QueryResultRow {
  request_fingerprint: Buffer;
  response_body: OnboardingApproval;
}

@Injectable()
export class OperatorRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async getTripTimeline(
    tripId: string,
  ): Promise<OperatorTripDiagnosticTimelineResponse | null> {
    const trip = await this.database.query<TripDiagnosticRow>(
      `SELECT id, state, version, created_at, updated_at
       FROM trip.trips
       WHERE id = $1`,
      [tripId],
    );
    const tripRow = trip.rows[0];
    if (!tripRow) return null;

    const [transitions, audits] = await Promise.all([
      this.database.query<TransitionRow>(
        `SELECT command, from_state, to_state, from_version, to_version,
                correlation_id, created_at
         FROM trip.state_transitions
         WHERE trip_id = $1
         ORDER BY to_version ASC`,
        [tripId],
      ),
      this.database.query<AuditSummaryRow>(
        `SELECT id, action, correlation_id, created_at
         FROM audit.operator_diagnostic_actions
         WHERE trip_id = $1
         ORDER BY created_at ASC`,
        [tripId],
      ),
    ]);

    return {
      trip: {
        id: tripRow.id,
        state: tripRow.state,
        version: tripRow.version,
        createdAt: tripRow.created_at.toISOString(),
        updatedAt: tripRow.updated_at.toISOString(),
      },
      transitions: transitions.rows.map((row) => ({
        command: row.command,
        fromState: row.from_state,
        toState: row.to_state,
        fromVersion: row.from_version,
        toVersion: row.to_version,
        correlationId: row.correlation_id,
        createdAt: row.created_at.toISOString(),
      })),
      diagnosticAudits: audits.rows.map((row) => ({
        id: row.id,
        action: row.action,
        correlationId: row.correlation_id,
        createdAt: row.created_at.toISOString(),
      })),
    };
  }

  async createDiagnosticAudit(input: {
    tripId: string;
    operatorUserId: string;
    reason: string;
    correlationId: string;
  }): Promise<OperatorDiagnosticAuditResponse | null> {
    return this.database.transaction(async (executor) => {
      const trip = await executor.query<{ id: string }>(
        'SELECT id FROM trip.trips WHERE id = $1 FOR KEY SHARE',
        [input.tripId],
      );
      if (!trip.rows[0]) return null;

      const result = await executor.query<AuditRow>(
        `INSERT INTO audit.operator_diagnostic_actions (
          id, trip_id, operator_user_id, action, reason, correlation_id
        ) VALUES ($1, $2, $3, 'DIAGNOSTIC_REVIEW', $4, $5)
        RETURNING id, action, reason, correlation_id, created_at`,
        [
          randomUUID(),
          input.tripId,
          input.operatorUserId,
          input.reason,
          input.correlationId,
        ],
      );
      const row = result.rows[0] as AuditRow;
      return {
        id: row.id,
        action: row.action,
        reason: row.reason,
        correlationId: row.correlation_id,
        createdAt: row.created_at.toISOString(),
      };
    });
  }

  async reviewDriver(input: {
    driverUserId: string;
    operatorUserId: string;
    reason: string;
    resultingStatus: 'APPROVED' | 'REJECTED';
    operation: Extract<
      OnboardingReviewOperation,
      'APPROVE_DRIVER' | 'REJECT_DRIVER'
    >;
    idempotencyKey: string;
    requestFingerprint: Buffer;
  }): Promise<DriverApprovalResult> {
    return this.database.transaction(async (executor) => {
      const receipt = await this.readOnboardingReceipt(executor, input);
      if (receipt) return { kind: 'REVIEWED', approval: receipt };

      const profile = await executor.query<DriverProfileApprovalRow>(
        `SELECT user_id, phone, approval_status
         FROM driver.driver_profiles
         WHERE user_id = $1
         FOR UPDATE`,
        [input.driverUserId],
      );
      const profileRow = profile.rows[0];
      if (!profileRow) return { kind: 'NOT_FOUND' };
      if (input.resultingStatus === 'APPROVED' && !profileRow.phone?.trim()) {
        return { kind: 'PROFILE_INCOMPLETE' };
      }
      if (profileRow.approval_status !== 'PENDING') {
        return { kind: 'NOT_PENDING' };
      }

      await executor.query(
        `UPDATE driver.driver_profiles
         SET approval_status = $2, review_reason = $3,
             reviewed_at = now(), reviewed_by_user_id = $4
         WHERE user_id = $1`,
        [
          input.driverUserId,
          input.resultingStatus,
          input.reason,
          input.operatorUserId,
        ],
      );
      const approval = await this.createOnboardingApprovalAction(executor, {
        subjectType: 'DRIVER_PROFILE',
        driverUserId: input.driverUserId,
        vehicleId: null,
        previousStatus: profileRow.approval_status,
        resultingStatus: input.resultingStatus,
        reason: input.reason,
        operatorUserId: input.operatorUserId,
      });
      await this.writeOnboardingReceipt(executor, input, approval);
      return {
        kind: 'REVIEWED',
        approval,
      };
    });
  }

  async reviewVehicle(input: {
    driverUserId: string;
    vehicleId: string;
    operatorUserId: string;
    reason: string;
    resultingStatus: 'APPROVED' | 'REJECTED';
    operation: Extract<
      OnboardingReviewOperation,
      'APPROVE_VEHICLE' | 'REJECT_VEHICLE'
    >;
    idempotencyKey: string;
    requestFingerprint: Buffer;
  }): Promise<VehicleApprovalResult> {
    return this.database.transaction(async (executor) => {
      const receipt = await this.readOnboardingReceipt(executor, input);
      if (receipt) return { kind: 'REVIEWED', approval: receipt };

      const profile = await executor.query<DriverProfileApprovalRow>(
        `SELECT user_id, phone, approval_status
         FROM driver.driver_profiles
         WHERE user_id = $1
         FOR UPDATE`,
        [input.driverUserId],
      );
      const profileRow = profile.rows[0];
      if (!profileRow) return { kind: 'DRIVER_NOT_FOUND' };

      const vehicle = await executor.query<VehicleApprovalRow>(
        `SELECT id, approval_status
         FROM driver.vehicles
         WHERE id = $1 AND driver_user_id = $2
         FOR UPDATE`,
        [input.vehicleId, input.driverUserId],
      );
      const vehicleRow = vehicle.rows[0];
      if (!vehicleRow) return { kind: 'VEHICLE_NOT_FOUND' };
      if (
        input.resultingStatus === 'APPROVED' &&
        profileRow.approval_status !== 'APPROVED'
      ) {
        return { kind: 'DRIVER_NOT_APPROVED' };
      }
      if (vehicleRow.approval_status !== 'PENDING') {
        return { kind: 'NOT_PENDING' };
      }

      if (input.resultingStatus === 'APPROVED') {
        await executor.query(
          `UPDATE driver.vehicles
           SET is_selected = false
           WHERE driver_user_id = $1 AND is_selected = true`,
          [input.driverUserId],
        );
      }
      await executor.query(
        `UPDATE driver.vehicles
         SET approval_status = $2, is_selected = CASE WHEN $2 = 'APPROVED' THEN true ELSE false END,
             review_reason = $3, reviewed_at = now(), reviewed_by_user_id = $4
         WHERE id = $1`,
        [
          input.vehicleId,
          input.resultingStatus,
          input.reason,
          input.operatorUserId,
        ],
      );
      const approval = await this.createOnboardingApprovalAction(executor, {
        subjectType: 'VEHICLE',
        driverUserId: input.driverUserId,
        vehicleId: input.vehicleId,
        previousStatus: vehicleRow.approval_status,
        resultingStatus: input.resultingStatus,
        reason: input.reason,
        operatorUserId: input.operatorUserId,
      });
      await this.writeOnboardingReceipt(executor, input, approval);
      return {
        kind: 'REVIEWED',
        approval,
      };
    });
  }

  private async readOnboardingReceipt(
    executor: DatabaseExecutor,
    input: {
      operatorUserId: string;
      operation: OnboardingReviewOperation;
      idempotencyKey: string;
      requestFingerprint: Buffer;
    },
  ): Promise<OnboardingApproval | null> {
    await executor.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `${input.operatorUserId}:operator-onboarding:${input.operation}:${input.idempotencyKey}`,
    ]);
    const result = await executor.query<OnboardingReceiptRow>(
      `SELECT request_fingerprint, response_body
       FROM operator.command_receipts
       WHERE actor_user_id = $1 AND operation = $2 AND idempotency_key = $3
       FOR UPDATE`,
      [input.operatorUserId, input.operation, input.idempotencyKey],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (!sameDigest(row.request_fingerprint, input.requestFingerprint)) {
      throw new OperatorCommandError('IDEMPOTENCY_KEY_REUSED');
    }
    return row.response_body;
  }

  private async writeOnboardingReceipt(
    executor: DatabaseExecutor,
    input: {
      operatorUserId: string;
      operation: OnboardingReviewOperation;
      idempotencyKey: string;
      requestFingerprint: Buffer;
    },
    approval: OnboardingApproval,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO operator.command_receipts (
        actor_user_id, operation, idempotency_key, request_fingerprint, response_body
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        input.operatorUserId,
        input.operation,
        input.idempotencyKey,
        input.requestFingerprint,
        JSON.stringify(approval),
      ],
    );
  }

  private async createOnboardingApprovalAction(
    executor: DatabaseExecutor,
    input: {
      subjectType: 'DRIVER_PROFILE' | 'VEHICLE';
      driverUserId: string;
      vehicleId: string | null;
      previousStatus: string;
      resultingStatus: 'APPROVED' | 'REJECTED';
      reason: string;
      operatorUserId: string;
    },
  ): Promise<OnboardingApproval> {
    const result = await executor.query<ApprovalActionRow>(
      `INSERT INTO driver.onboarding_approval_actions (
        id, subject_type, driver_user_id, vehicle_id, previous_status,
        resulting_status, reason, operator_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, subject_type, driver_user_id, vehicle_id, previous_status,
                resulting_status, reason, operator_user_id, created_at`,
      [
        randomUUID(),
        input.subjectType,
        input.driverUserId,
        input.vehicleId,
        input.previousStatus,
        input.resultingStatus,
        input.reason,
        input.operatorUserId,
      ],
    );
    const row = result.rows[0] as ApprovalActionRow;
    return {
      id: row.id,
      subjectType: row.subject_type,
      driverUserId: row.driver_user_id,
      vehicleId: row.vehicle_id,
      previousStatus: row.previous_status,
      resultingStatus: row.resulting_status,
      reason: row.reason,
      reviewedByUserId: row.operator_user_id,
      reviewedAt: row.created_at.toISOString(),
    };
  }
}

function sameDigest(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}
