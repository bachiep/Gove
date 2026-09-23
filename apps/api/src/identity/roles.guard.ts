import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { RoleCode } from '@gove/contracts';

import { ApiError } from '../common/http/api-error.js';
import { rolesMetadataKey } from './roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleCode[]>(
      rolesMetadataKey,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles?.length) return true;

    const actor = context.switchToHttp().getRequest<FastifyRequest>().actor;
    if (!actor || !requiredRoles.some((role) => actor.roles.includes(role))) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'AUTH_FORBIDDEN',
        'You do not have permission for this action.',
      );
    }
    return true;
  }
}
