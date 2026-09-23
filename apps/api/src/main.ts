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
  app
    .getHttpAdapter()
    .getInstance()
    .addHook(
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
