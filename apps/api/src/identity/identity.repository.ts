import { createHash, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedActor, RoleCode } from '@gove/contracts';
import type { QueryResultRow } from 'pg';

import {
  DatabaseService,
  type DatabaseExecutor,
} from '../database/database.service.js';
import type { RegisteredActor, SessionActor } from './identity.types.js';

interface ActorRow extends QueryResultRow {
  id: string;
  email: string;
  display_name: string;
  auth_epoch: number;
  roles: RoleCode[];
}

interface CredentialRow extends ActorRow {
  password_hash: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
}

interface SessionRow extends QueryResultRow {
  id: string;
  user_id: string;
  family_id: string;
  status: 'ACTIVE' | 'ROTATED' | 'REVOKED' | 'EXPIRED';
  expires_at: Date;
}

export interface RegistrationInput {
  userId: string;
  email: string;
  displayName: string;
  passwordHash: string;
  initialRole: Extract<RoleCode, 'CUSTOMER' | 'DRIVER'>;
  idempotencyKey: string;
  requestFingerprint: Buffer;
}

export interface NewSession {
  id: string;
  familyId: string;
  tokenDigest: Buffer;
  expiresAt: Date;
}

@Injectable()
export class IdentityRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async register(input: RegistrationInput): Promise<RegisteredActor> {
    const subjectDigest = digest(input.email);

    return this.database.transaction(async (executor) => {
      await executor.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        input.email,
      ]);
      const receipt = await executor.query<{
        request_fingerprint: Buffer;
        response_body: RegisteredActor;
      }>(
        `SELECT request_fingerprint, response_body
         FROM identity.command_receipts
         WHERE operation = 'auth.register'
           AND subject_digest = $1
           AND idempotency_key = $2
         FOR UPDATE`,
        [subjectDigest, input.idempotencyKey],
      );

      const existingReceipt = receipt.rows[0];
      if (existingReceipt) {
        if (
          !sameDigest(
            existingReceipt.request_fingerprint,
            input.requestFingerprint,
          )
        ) {
          throw new IdentityConflictError('IDEMPOTENCY_KEY_REUSED');
        }
        return existingReceipt.response_body;
      }

      const existingUser = await executor.query<{ id: string }>(
        'SELECT id FROM identity.users WHERE email = $1 FOR UPDATE',
        [input.email],
      );
      if (existingUser.rowCount) {
        throw new IdentityConflictError('EMAIL_ALREADY_REGISTERED');
      }

      await executor.query(
        `INSERT INTO identity.users (id, email, display_name)
         VALUES ($1, $2, $3)`,
        [input.userId, input.email, input.displayName],
      );
      await executor.query(
        `INSERT INTO identity.credentials (user_id, password_hash)
         VALUES ($1, $2)`,
        [input.userId, input.passwordHash],
      );
      await executor.query(
        `INSERT INTO identity.user_roles (user_id, role_code)
         VALUES ($1, $2)`,
        [input.userId, input.initialRole],
      );
      if (input.initialRole === 'DRIVER') {
        await executor.query(
          'INSERT INTO driver.driver_profiles (user_id) VALUES ($1)',
          [input.userId],
        );
      }

      const actor: RegisteredActor = {
        id: input.userId,
        email: input.email,
        displayName: input.displayName,
        roles: [input.initialRole],
        authEpoch: 0,
      };
      await executor.query(
        `INSERT INTO identity.command_receipts
          (operation, subject_digest, idempotency_key, request_fingerprint, response_body)
         VALUES ('auth.register', $1, $2, $3, $4)`,
        [
          subjectDigest,
          input.idempotencyKey,
          input.requestFingerprint,
          JSON.stringify(actor),
        ],
      );
      return actor;
    });
  }

  async findCredential(email: string): Promise<CredentialRow | null> {
    const result = await this.database.query<CredentialRow>(
      `SELECT u.id, u.email, u.display_name, u.auth_epoch, u.status,
              c.password_hash,
              coalesce(array_agg(ur.role_code) FILTER (WHERE ur.revoked_at IS NULL), '{}') AS roles
       FROM identity.users u
       JOIN identity.credentials c ON c.user_id = u.id AND c.disabled_at IS NULL
       LEFT JOIN identity.user_roles ur ON ur.user_id = u.id
       WHERE u.email = $1
       GROUP BY u.id, c.password_hash`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async createSession(userId: string, session: NewSession): Promise<void> {
    await this.database.query(
      `INSERT INTO identity.refresh_sessions
        (id, user_id, family_id, token_digest, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        session.id,
        userId,
        session.familyId,
        session.tokenDigest,
        session.expiresAt,
      ],
    );
  }

  async rotateSession(
    currentDigest: Buffer,
    nextSession: NewSession,
  ): Promise<SessionActor | null> {
    return this.database.transaction(async (executor) => {
      const current = await executor.query<SessionRow>(
        `SELECT id, user_id, family_id, status, expires_at
         FROM identity.refresh_sessions
         WHERE token_digest = $1
         FOR UPDATE`,
        [currentDigest],
      );
      const session = current.rows[0];
      if (!session) return null;

      if (session.status === 'ROTATED') {
        await revokeFamily(executor, session.family_id, 'TOKEN_REUSE');
        return null;
      }
      if (session.status !== 'ACTIVE') return null;
      if (session.expires_at.getTime() <= Date.now()) {
        await executor.query(
          `UPDATE identity.refresh_sessions
           SET status = 'EXPIRED'
           WHERE id = $1`,
          [session.id],
        );
        return null;
      }

      await executor.query(
        `UPDATE identity.refresh_sessions
         SET status = 'ROTATED', revoked_at = now(), revoke_reason = 'ROTATED',
             replaced_by_session_id = $2, last_seen_at = now()
         WHERE id = $1`,
        [session.id, nextSession.id],
      );
      await executor.query(
        `INSERT INTO identity.refresh_sessions
          (id, user_id, family_id, token_digest, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          nextSession.id,
          session.user_id,
          session.family_id,
          nextSession.tokenDigest,
          nextSession.expiresAt,
        ],
      );
      return this.findSessionActor(executor, session.user_id, nextSession.id);
    });
  }

  async revokeSession(tokenDigest: Buffer): Promise<void> {
    await this.database.query(
      `UPDATE identity.refresh_sessions
       SET status = 'REVOKED', revoked_at = now(), revoke_reason = 'LOGOUT'
       WHERE token_digest = $1 AND status = 'ACTIVE'`,
      [tokenDigest],
    );
  }

  async findSessionActor(
    executor: DatabaseExecutor,
    userId: string,
    sessionId: string,
  ): Promise<SessionActor | null> {
    const result = await executor.query<ActorRow>(
      `SELECT u.id, u.email, u.display_name, u.auth_epoch,
              coalesce(array_agg(ur.role_code) FILTER (WHERE ur.revoked_at IS NULL), '{}') AS roles
       FROM identity.users u
       JOIN identity.refresh_sessions rs ON rs.user_id = u.id
       LEFT JOIN identity.user_roles ur ON ur.user_id = u.id
       WHERE u.id = $1 AND u.status = 'ACTIVE'
         AND rs.id = $2 AND rs.status = 'ACTIVE' AND rs.expires_at > now()
       GROUP BY u.id`,
      [userId, sessionId],
    );
    const row = result.rows[0];
    return row ? toSessionActor(row, sessionId) : null;
  }

  async findActiveActor(
    userId: string,
    sessionId: string,
  ): Promise<SessionActor | null> {
    return this.findSessionActor(this.database, userId, sessionId);
  }
}

export class IdentityConflictError extends Error {
  constructor(
    readonly code: 'EMAIL_ALREADY_REGISTERED' | 'IDEMPOTENCY_KEY_REUSED',
  ) {
    super(code);
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function sameDigest(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

async function revokeFamily(
  executor: DatabaseExecutor,
  familyId: string,
  reason: string,
): Promise<void> {
  await executor.query(
    `UPDATE identity.refresh_sessions
     SET status = 'REVOKED', revoked_at = now(), revoke_reason = $2
     WHERE family_id = $1 AND status = 'ACTIVE'`,
    [familyId, reason],
  );
}

function toSessionActor(row: ActorRow, sessionId: string): SessionActor {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    roles: row.roles,
    authEpoch: row.auth_epoch,
    sessionId,
  };
}

export function requestFingerprint(value: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(value)).digest();
}

export function actorFromCredential(row: CredentialRow): AuthenticatedActor & {
  authEpoch: number;
} {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    roles: row.roles,
    authEpoch: row.auth_epoch,
  };
}
