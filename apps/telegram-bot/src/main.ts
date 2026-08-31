import './tracing';
import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AllExceptionsFilter, createValidationPipe } from '@afa/shared';
import type { EnvironmentVariables } from '@afa/shared';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';

/**
 * TASK-BOT-001 — this app now exposes one HTTP surface: the Telegram
 * webhook endpoint (Chapter 3 §3.3.1). Still not "the API" (Chapter 14's
 * REST surface remains apps/api's alone) — this is transport ingress for
 * Telegram specifically, not a general-purpose REST API. Mirrors apps/api's
 * own bootstrap (helmet, global exception filter, validation pipe) since
 * this app now has the same class of HTTP-request surface to defend.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(createValidationPipe());
  app.use(helmet());
  app.enableShutdownHooks();

  const config = app.get(ConfigService<EnvironmentVariables>);
  const port = config.get('PORT', { infer: true }) ?? 3000;
  await app.listen(port);
}

void bootstrap();
