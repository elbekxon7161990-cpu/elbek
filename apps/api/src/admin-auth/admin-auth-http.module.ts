import { Module } from '@nestjs/common';
import { AdminAuthModule } from '@afa/application';
import {
  AdminAuthProvidersModule,
  AdminMfaChallengeRepositoryModule,
  AdminRepositoryModule,
  AdminSessionRepositoryModule,
} from '@afa/infrastructure';

import { AdminAuthController } from './admin-auth.controller';
import { AdminSessionGuard } from './admin-session.guard';

/**
 * TASK-AUTH-002 — apps/api's own composition-root module (same
 * "small feature module wrapping just its own controller" shape as
 * `HealthModule`), named `AdminAuthHttpModule` to avoid colliding with
 * `@afa/application`'s `AdminAuthModule` it imports. Binds every port this
 * feature needs (`AdminRepositoryModule`/`AdminSessionRepositoryModule`/
 * `AdminMfaChallengeRepositoryModule`/`AdminAuthProvidersModule` are all
 * `@Global()`, imported here for discoverability, same precedent
 * `apps/telegram-bot`'s own module already established for
 * `AccountDeletionModule`).
 */
@Module({
  imports: [
    AdminAuthModule,
    AdminRepositoryModule,
    AdminSessionRepositoryModule,
    AdminMfaChallengeRepositoryModule,
    AdminAuthProvidersModule,
  ],
  controllers: [AdminAuthController],
  providers: [AdminSessionGuard],
})
export class AdminAuthHttpModule {}
