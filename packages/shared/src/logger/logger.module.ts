import type { DynamicModule } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import { NodeEnv } from '../config/environment-variables';

/**
 * Structured logging (pino) for every bootstrap app. Chapter 11 §11.4 (Ch.13
 * §13.1's audited-elsewhere note) requires structured logs with no raw
 * financial field values — this module only configures the transport/level;
 * the "never log a raw amount/merchant/original_text" discipline is enforced
 * at the call site in packages/application and packages/infrastructure, not
 * here, since this module has no visibility into what a caller logs.
 */
export class AppLoggerModule {
  static forRoot(serviceName: string): DynamicModule {
    return PinoLoggerModule.forRootAsync({
      useFactory: () => {
        const isDevelopment = process.env.NODE_ENV !== NodeEnv.Production;

        return {
          pinoHttp: {
            name: serviceName,
            level: process.env.LOG_LEVEL ?? 'info',
            transport: isDevelopment
              ? {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    singleLine: true,
                    translateTime: 'HH:MM:ss.l',
                  },
                }
              : undefined,
            redact: {
              // Defense-in-depth mirror of Chapter 11's log-minimization
              // requirement — request headers are the one place a stray
              // credential is most likely to leak into a log line by accident.
              // `x-telegram-bot-api-secret-token` (TASK-MVP-001) — the
              // Telegram webhook secret arrives on every real webhook POST
              // (apps/telegram-bot's `TelegramWebhookController`); pino-http's
              // default request-header auto-logging would otherwise capture it.
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                "req.headers['x-telegram-bot-api-secret-token']",
              ],
              remove: true,
            },
          },
        };
      },
    });
  }
}
