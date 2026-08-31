import { ConfigModule } from '@nestjs/config';
import type { DynamicModule } from '@nestjs/common';

import { validateEnv } from './validate-env';

/**
 * Thin wrapper around @nestjs/config's ConfigModule so every bootstrap app
 * (apps/api, apps/telegram-bot, apps/worker) configures env loading and
 * validation identically, rather than each re-declaring `envFilePath`/
 * `validate`/`isGlobal` independently and risking drift between them.
 */
export class AppConfigModule {
  // ConfigModule.forRoot()'s declared return type is DynamicModule |
  // Promise<DynamicModule> (NestJS's ModuleMetadata.imports accepts both —
  // Nest resolves a promise entry internally) — this wrapper must accept
  // whichever ConfigModule.forRoot() itself actually returns rather than
  // narrowing to DynamicModule and fighting the real signature.
  static forRoot(): DynamicModule | Promise<DynamicModule> {
    return ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: ['.env'],
    });
  }
}
