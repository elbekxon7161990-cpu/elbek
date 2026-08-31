import { Module } from '@nestjs/common';
import { AdminAuthModule, AdminElevationModule } from '@afa/application';
import {
  AdminAuthProvidersModule,
  AdminElevationRepositoryModule,
  AdminMfaChallengeRepositoryModule,
  AdminRepositoryModule,
  AdminSessionRepositoryModule,
  AuditLogRepositoryModule,
} from '@afa/infrastructure';

import { AdminSessionGuard } from '../admin-auth/admin-session.guard';
import { AdminElevationController } from './admin-elevation.controller';
import { RequireSuperAdminGuard } from './require-super-admin.guard';

/**
 * TASK-AUTH-005 — apps/api's own composition-root module (same shape as
 * `ApiTokenHttpModule`). Re-provides `AdminSessionGuard` here (importing the
 * SAME class from `../admin-auth/admin-session.guard`, never a duplicate
 * implementation) for the identical reason `ApiTokenHttpModule` already
 * documents: `AdminAuthHttpModule` does not export it, and AUTH-002's own
 * files are left untouched rather than adding an export there. Imports
 * `AdminAuthModule` (application) for `ValidateAdminSessionUseCase`, plus
 * the same `@Global()` infrastructure modules `ApiTokenHttpModule` itself
 * needs for `AdminAuthModule`'s eagerly-instantiated providers
 * (`AdminLoginPasswordStepUseCase` etc., never called from this module, but
 * still instantiated as part of `AdminAuthModule`'s own provider list).
 * `AuditLogRepositoryModule` is imported for discoverability even though
 * `PrismaAdminElevationRepository.grant()` writes `audit_log` directly
 * inside its own transaction rather than through `AUDIT_LOG_REPOSITORY` —
 * see that repository's own doc comment for why.
 */
@Module({
  imports: [
    AdminElevationModule,
    AdminElevationRepositoryModule,
    AuditLogRepositoryModule,
    AdminAuthModule,
    AdminRepositoryModule,
    AdminSessionRepositoryModule,
    AdminMfaChallengeRepositoryModule,
    AdminAuthProvidersModule,
  ],
  controllers: [AdminElevationController],
  providers: [AdminSessionGuard, RequireSuperAdminGuard],
})
export class AdminElevationHttpModule {}
