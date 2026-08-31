import './tracing';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // No HTTP listener, no Telegram transport — this process only executes
  // queues (Chapter 3 §3.3.3).
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
}

void bootstrap();
