import { Module } from '@nestjs/common';
import { AdminAuthModule, ApiTokenModule } from '@afa/application';
import {
  AdminAuthProvidersModule,
  AdminMfaChallengeRepositoryModule,
  AdminRepositoryModule,
  AdminSessionRepositoryModule,
  ApiTokenRepositoryModule,
} from '@afa/infrastructure';

import { AdminSessionGuard } from '../admin-auth/admin-session.guard';
import { ApiTokenController } from './api-token.controller';
import { ApiTokenGuard } from './api-token.guard';

/**
 * TASK-AUTH-003 — apps/api's own composition-root module (same shape as
 * `AdminAuthHttpModule`). Re-provides `AdminSessionGuard` here (importing
 * the SAME class from `../admin-auth/admin-session.guard`, never a
 * duplicate implementation) because `@UseGuards(AdminSessionGuard)` on
 * `ApiTokenController` needs it resolvable in THIS module's own DI scope —
 * `AdminAuthHttpModule` does not export it, and per this task's explicit
 * instruction AUTH-002's own files are left untouched rather than adding an
 * export there. Also imports `AdminAuthModule` (application) for the
 * `ValidateAdminSessionUseCase` `AdminSessionGuard` itself needs, plus the
 * same `@Global()` infrastructure modules `AdminAuthHttpModule` itself
 * imports (`AdminRepositoryModule`/`AdminSessionRepositoryModule`/
 * `AdminMfaChallengeRepositoryModule`/`AdminAuthProvidersModule`) —
 * `AdminAuthModule` eagerly instantiates ALL three of its use cases
 * (including `AdminLoginPasswordStepUseCase`, which this module never
 * calls), so their own dependencies must be resolvable here too, not only
 * `ValidateAdminSessionUseCase`'s.
 */
@Module({
  imports: [
    ApiTokenModule,
    ApiTokenRepositoryModule,
    AdminAuthModule,
    AdminRepositoryModule,
    AdminSessionRepositoryModule,
    AdminMfaChallengeRepositoryModule,
    AdminAuthProvidersModule,
  ],
  controllers: [ApiTokenController],
  providers: [ApiTokenGuard, AdminSessionGuard],
})
export class ApiTokenHttpModule {}
