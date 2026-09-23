import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';
import { readAppConfig } from './config/app-config.js';
import { loadLocalEnvironment } from './environment.js';

async function bootstrap(): Promise<void> {
  loadLocalEnvironment();
  const config = readAppConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  await app.register(helmet);
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');

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

  await app.listen(config.API_PORT, config.API_HOST);
}

await bootstrap();
