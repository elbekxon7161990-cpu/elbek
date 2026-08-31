import { Module } from '@nestjs/common';

import { AdminLoginPasswordStepUseCase } from '../use-cases/admin-login-password-step.use-case';
import { AdminLogoutUseCase } from '../use-cases/admin-logout.use-case';
import { AdminMfaVerificationUseCase } from '../use-cases/admin-mfa-verification.use-case';
import { ValidateAdminSessionUseCase } from '../use-cases/validate-admin-session.use-case';

/**
 * TASK-AUTH-002 — the request-time admin-auth use cases apps/api's
 * `admin-auth` controller/guard need. Does not bind any repository/port
 * token — that is the composition root's job (packages/infrastructure's
 * `AdminRepositoryModule`/`AdminSessionRepositoryModule`/
 * `AdminMfaChallengeRepositoryModule`/`AdminAuthProvidersModule`), same
 * split every other module in this package already established.
 *
 * Deliberately does NOT also export `BootstrapAdminUseCase` — see
 * `AdminBootstrapModule` for why (mirrors `AccountDeletionModule`'s own
 * precedent for not bundling an operationally-distinct use case into the
 * module the runtime HTTP app imports).
 */
@Module({
  providers: [
    AdminLoginPasswordStepUseCase,
    AdminLogoutUseCase,
    AdminMfaVerificationUseCase,
    ValidateAdminSessionUseCase,
  ],
  exports: [
    AdminLoginPasswordStepUseCase,
    AdminLogoutUseCase,
    AdminMfaVerificationUseCase,
    ValidateAdminSessionUseCase,
  ],
})
export class AdminAuthModule {}
