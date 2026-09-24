import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type {
  AuthenticationResponse,
  RegistrationResponse,
} from '@gove/contracts';
import type { FastifyReply } from 'fastify';

import { ApiError } from '../common/http/api-error.js';
import { parseInput } from '../common/http/validation.js';
import { readAppConfig } from '../config/app-config.js';
import { AuthenticationGuard } from './authentication.guard.js';
import { AuthService } from './auth.service.js';
import { CurrentActor } from './current-actor.decorator.js';
import type { SessionActor } from './identity.types.js';
import { loginSchema, registerSchema } from './auth.schemas.js';

const refreshCookieName = 'gove_refresh';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly config = readAppConfig();

  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a Customer or Driver account' })
  @ApiBody({ description: 'Account registration details' })
  @ApiCreatedResponse({ description: 'The account was registered' })
  async register(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<RegistrationResponse> {
    if (
      !idempotencyKey ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 128
    ) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required.',
      );
    }
    const input = parseInput(registerSchema, body);
    return this.auth.register({ ...input, idempotencyKey });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate and start a session' })
  @ApiOkResponse({ description: 'An access token and session were issued' })
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<AuthenticationResponse> {
    const input = parseInput(loginSchema, body);
    const result = await this.auth.login(input.email, input.password);
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, actor: result.actor };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the current refresh session' })
  async refresh(
    @Headers('origin') origin: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<AuthenticationResponse> {
    this.assertAllowedOrigin(origin);
    const refreshToken = readCookie(cookie, refreshCookieName);
    if (!refreshToken) {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'AUTH_SESSION_INVALID',
        'The session is invalid or has expired.',
      );
    }
    const result = await this.auth.refresh(refreshToken);
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, actor: result.actor };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current refresh session' })
  async logout(
    @Headers('origin') origin: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<void> {
    this.assertAllowedOrigin(origin);
    const refreshToken = readCookie(cookie, refreshCookieName);
    if (refreshToken) await this.auth.logout(refreshToken);
    response.clearCookie(refreshCookieName, { path: '/api/v1/auth' });
  }

  @Get('me')
  @UseGuards(AuthenticationGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Read the current authenticated actor' })
  @ApiOkResponse({ description: 'The active actor' })
  me(@CurrentActor() actor: SessionActor): {
    actor: AuthenticationResponse['actor'];
  } {
    const {
      authEpoch: _authEpoch,
      sessionId: _sessionId,
      ...safeActor
    } = actor;
    return { actor: safeActor };
  }

  private setRefreshCookie(response: FastifyReply, token: string): void {
    response.setCookie(refreshCookieName, token, {
      httpOnly: true,
      path: '/api/v1/auth',
      sameSite: 'strict',
      secure: this.config.NODE_ENV === 'production',
      maxAge: this.config.AUTH_REFRESH_TTL_DAYS * 86_400,
    });
  }

  private assertAllowedOrigin(origin: string | undefined): void {
    if (origin !== this.config.WEB_ORIGIN) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'AUTH_ORIGIN_FORBIDDEN',
        'The request origin is not allowed.',
      );
    }
  }
}

function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}
