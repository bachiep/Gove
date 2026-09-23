import { Module } from '@nestjs/common';

import { AuthenticationGuard } from './authentication.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { IdentityRepository } from './identity.repository.js';
import { PasswordService } from './password.service.js';
import { RolesGuard } from './roles.guard.js';
import { TokenService } from './token.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthenticationGuard,
    IdentityRepository,
    PasswordService,
    RolesGuard,
    TokenService,
  ],
  exports: [AuthenticationGuard, AuthService, IdentityRepository, RolesGuard],
})
export class IdentityModule {}
