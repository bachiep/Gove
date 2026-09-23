import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AuthenticationResponse,
  RegistrationResponse,
  RoleCode,
} from '@gove/contracts';

import { ApiError } from '../common/http/api-error.js';
import { readAppConfig } from '../config/app-config.js';
import {
  IdentityConflictError,
  IdentityRepository,
  actorFromCredential,
  requestFingerprint,
} from './identity.repository.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import type { SessionActor } from './identity.types.js';

export interface RegisterCommand {
  email: string;
  displayName: string;
  password: string;
  requestedRole: Extract<RoleCode, 'CUSTOMER' | 'DRIVER'>;
  idempotencyKey: string;
}

export interface AuthenticationResult extends AuthenticationResponse {
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly config = readAppConfig();

  constructor(
    @Inject(IdentityRepository) private readonly repository: IdentityRepository,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  async register(command: RegisterCommand): Promise<RegistrationResponse> {
    const email = normalizeEmail(command.email);
    const displayName = command.displayName.trim();
    const passwordHash = await this.passwords.hash(command.password);

    try {
      const actor = await this.repository.register({
        userId: randomUUID(),
        email,
        displayName,
        passwordHash,
        initialRole: command.requestedRole,
        idempotencyKey: command.idempotencyKey,
        requestFingerprint: requestFingerprint({
          email,
          displayName,
          requestedRole: command.requestedRole,
          passwordDigest: createHmac('sha256', this.config.AUTH_REFRESH_PEPPER)
            .update(command.password)
            .digest('hex'),
        }),
      });
      return { actor: stripAuthEpoch(actor) };
    } catch (error) {
      if (error instanceof IdentityConflictError) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          error.code,
          error.code === 'EMAIL_ALREADY_REGISTERED'
            ? 'An account already exists for this email.'
            : 'The idempotency key was reused with a different request.',
        );
      }
      throw error;
    }
  }

  async login(
    emailInput: string,
    password: string,
  ): Promise<AuthenticationResult> {
    const credential = await this.repository.findCredential(
      normalizeEmail(emailInput),
    );
    if (!credential || credential.status !== 'ACTIVE') {
      await this.passwords.verify(
        await this.passwords.hash('non-matching-password'),
        password,
      );
      throw invalidCredentials();
    }

    if (!(await this.passwords.verify(credential.password_hash, password))) {
      throw invalidCredentials();
    }

    return this.createAuthenticationResult(actorFromCredential(credential));
  }

  async refresh(refreshToken: string): Promise<AuthenticationResult> {
    const next = this.newSession();
    const actor = await this.repository.rotateSession(
      this.refreshDigest(refreshToken),
      next,
    );
    if (!actor) throw invalidSession();
    return this.createAuthenticationResult(actor, next);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.repository.revokeSession(this.refreshDigest(refreshToken));
  }

  async authenticateAccessToken(token: string): Promise<SessionActor> {
    try {
      const claims = await this.tokens.verifyAccessToken(token);
      const actor = await this.repository.findActiveActor(
        claims.sub,
        claims.sid,
      );
      if (!actor || actor.authEpoch !== claims.ae) throw invalidSession();
      return actor;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw invalidSession();
    }
  }

  private async createAuthenticationResult(
    actor: Omit<SessionActor, 'sessionId'>,
    existingSession?: {
      id: string;
      familyId: string;
      tokenDigest: Buffer;
      expiresAt: Date;
      rawToken: string;
    },
  ): Promise<AuthenticationResult> {
    const session = existingSession ?? this.newSession();
    if (!existingSession)
      await this.repository.createSession(actor.id, session);

    const accessToken = await this.tokens.issueAccessToken({
      sub: actor.id,
      sid: session.id,
      ae: actor.authEpoch,
    });
    return {
      accessToken,
      refreshToken: session.rawToken,
      actor: stripAuthEpoch(actor),
    };
  }

  private newSession(): {
    id: string;
    familyId: string;
    tokenDigest: Buffer;
    expiresAt: Date;
    rawToken: string;
  } {
    const rawToken = randomBytes(32).toString('base64url');
    return {
      id: randomUUID(),
      familyId: randomUUID(),
      tokenDigest: this.refreshDigest(rawToken),
      expiresAt: new Date(
        Date.now() + this.config.AUTH_REFRESH_TTL_DAYS * 86_400_000,
      ),
      rawToken,
    };
  }

  private refreshDigest(token: string): Buffer {
    return createHmac('sha256', this.config.AUTH_REFRESH_PEPPER)
      .update(token)
      .digest();
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function stripAuthEpoch(actor: {
  id: string;
  email: string;
  displayName: string;
  roles: RoleCode[];
}): AuthenticationResponse['actor'] {
  return {
    id: actor.id,
    email: actor.email,
    displayName: actor.displayName,
    roles: actor.roles,
  };
}

function invalidCredentials(): ApiError {
  return new ApiError(
    HttpStatus.UNAUTHORIZED,
    'AUTH_INVALID_CREDENTIALS',
    'Email or password is invalid.',
  );
}

function invalidSession(): ApiError {
  return new ApiError(
    HttpStatus.UNAUTHORIZED,
    'AUTH_SESSION_INVALID',
    'The session is invalid or has expired.',
  );
}
