import { SetMetadata } from '@nestjs/common';
import type { RoleCode } from '@gove/contracts';

export const rolesMetadataKey = 'gove:roles';

export const Roles = (...roles: RoleCode[]) =>
  SetMetadata(rolesMetadataKey, roles);
