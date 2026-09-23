import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/http/api-exception.filter.js';
import { InMemoryRateLimiter } from './common/http/rate-limiter.js';
import { readAppConfig } from './config/app-config.js';
import { loadLocalEnvironment } from './environment.js';

export async function createApplication(): Promise<NestFastifyApplication> {
  loadLocalEnvironment();
  const config = readAppConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  await app.register(cookie);
  await app.register(helmet);
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  const authRateLimiter = new InMemoryRateLimiter(
    config.AUTH_RATE_LIMIT_MAX,
    config.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1_000,
  );
  const httpServer = app.getHttpAdapter().getInstance();
  httpServer.addHook(
    'onRequest',
    async (
      request: { id: string; ip: string; url: string },
      reply: {
        header: (name: string, value: string) => void;
        code: (statusCode: number) => {
          send: (payload: unknown) => unknown;
        };
      },
    ) => {
      const path = request.url.split('?')[0];
      if (
        path !== '/api/v1/auth/register' &&
        path !== '/api/v1/auth/login' &&
        path !== '/api/v1/auth/refresh'
      ) {
        return;
      }
      const decision = authRateLimiter.check(`${request.ip}:${path}`);
      reply.header('x-ratelimit-limit', String(decision.limit));
      reply.header('x-ratelimit-remaining', String(decision.remaining));
      if (decision.allowed) return;
      reply.header('retry-after', String(decision.retryAfterSeconds));
      return reply.code(429).send({
        code: 'RATE_LIMITED',
        message: 'Too many authentication requests. Please retry later.',
        correlationId: request.id,
      });
    },
  );
  httpServer.addHook(
    'onSend',
    (
      request: { id: string },
      reply: { header: (name: string, value: string) => void },
      _payload: unknown,
      done: () => void,
    ) => {
      reply.header('x-correlation-id', request.id);
      done();
    },
  );

  const openApiConfig = new DocumentBuilder()
    .setTitle('Gove API')
    .setDescription('HTTP interface for the Gove ride-hailing platform')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, openApiConfig),
  );

  return app;
}

async function bootstrap(): Promise<void> {
  const config = readAppConfig();
  const app = await createApplication();
  await app.listen(config.API_PORT, config.API_HOST);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await bootstrap();
}
