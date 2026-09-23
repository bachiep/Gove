import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';

import { readAppConfig } from '../config/app-config.js';
import type { AccessTokenClaims } from './identity.types.js';

@Injectable()
export class TokenService {
  private readonly config = readAppConfig();
  private readonly secret = new TextEncoder().encode(
    this.config.AUTH_JWT_SECRET,
  );

  async issueAccessToken(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ sid: claims.sid, ae: claims.ae })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.config.AUTH_ISSUER)
      .setAudience(this.config.AUTH_AUDIENCE)
      .setIssuedAt()
      .setNotBefore('0s')
      .setExpirationTime(`${this.config.AUTH_ACCESS_TTL_SECONDS}s`)
      .setJti(crypto.randomUUID())
      .sign(this.secret);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const { payload } = await jwtVerify(token, this.secret, {
      algorithms: ['HS256'],
      issuer: this.config.AUTH_ISSUER,
      audience: this.config.AUTH_AUDIENCE,
    });

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      typeof payload.ae !== 'number'
    ) {
      throw new Error('Access token claims are invalid');
    }

    return { sub: payload.sub, sid: payload.sid, ae: payload.ae };
  }
}
