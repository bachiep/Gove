import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../common/http/api-error.js';
import { AuthService } from './auth.service.js';
import type { SessionActor } from './identity.types.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor?: SessionActor;
  }
}

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;
    if (!token) {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'AUTH_REQUIRED',
        'Authentication is required.',
      );
    }
    request.actor = await this.auth.authenticateAccessToken(token);
    return true;
  }
}
