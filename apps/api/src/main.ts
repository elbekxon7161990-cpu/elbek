import './tracing';
import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter, createValidationPipe, EnvironmentVariables } from '@afa/shared';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(createValidationPipe());
  app.use(helmet());
  app.enableShutdownHooks();

  const config = app.get(ConfigService<EnvironmentVariables>);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI Personal Finance Assistant API')
    .setDescription(
      'REST API surface (Chapter 14). Every endpoint traces back to an FR-API-* ID — see IMPLEMENTATION-BLUEPRINT.md §7 for implementation order.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = config.get('PORT', { infer: true }) ?? 3000;
  await app.listen(port);
}

void bootstrap();
