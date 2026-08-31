import { ValidationPipe } from '@nestjs/common';

/**
 * One validation-pipe configuration shared by every app that accepts
 * external input (apps/api's REST body/query/params; apps/telegram-bot's
 * parsed command payloads, if it ever validates structured input before
 * handing it to packages/application). Centralized so "whitelist unknown
 * fields away vs. reject them" is a single decision, not one made
 * per-app-and-forgotten.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  });
}
