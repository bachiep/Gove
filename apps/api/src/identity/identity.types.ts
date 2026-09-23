import type { AuthenticatedActor, RoleCode } from '@gove/contracts';

export type { RoleCode };

export interface SessionActor extends AuthenticatedActor {
  authEpoch: number;
  sessionId: string;
}

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  ae: number;
}

export interface RegisteredActor extends AuthenticatedActor {
  authEpoch: number;
}
