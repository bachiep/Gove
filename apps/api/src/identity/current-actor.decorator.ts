import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { SessionActor } from './identity.types.js';

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionActor =>
    context.switchToHttp().getRequest<{ actor: SessionActor }>().actor,
);
