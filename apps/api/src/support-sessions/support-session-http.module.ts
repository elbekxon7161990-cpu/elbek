import { Module } from '@nestjs/common';
import { AdminAuthModule, SupportSessionModule } from '@afa/application';
import {
  AdminAuthProvidersModule,
  AdminMfaChallengeRepositoryModule,
  AdminRepositoryModule,
  AdminSessionRepositoryModule,
  SupportSessionElevationRepositoryModule,
  SupportSessionRepositoryModule,
  UserRepositoryModule,
} from '@afa/infrastructure';

import { AdminSessionGuard } from '../admin-auth/admin-session.guard';
import { RequireSuperAdminGuard } from '../rbac/require-super-admin.guard';
import { RequireElevatedSupportSessionGuard } from './require-elevated-support-session.guard';
import { SupportSessionController } from './support-session.controller';
import { SupportSessionGuard } from './support-session.guard';

/**
 * TASK-SEC-006 — apps/api's own composition-root module (same shape as
 * `AdminElevationHttpModule`). Re-provides `AdminSessionGuard` and
 * `RequireSuperAdminGuard` here (importing the SAME classes, never
 * duplicate implementations) for the identical reason those sibling
 * modules already document. Imports `AdminAuthModule` (application) for
 * `ValidateAdminSessionUseCase`, plus the same `@Global()` infrastructure
 * modules every sibling http module needs for `AdminAuthModule`'s
 * eagerly-instantiated providers. `UserRepositoryModule` is needed by
 * `OpenSupportSessionUseCase`'s target-user existence check.
 */
@Module({
  imports: [
    SupportSessionModule,
    SupportSessionRepositoryModule,
    SupportSessionElevationRepositoryModule,
    UserRepositoryModule,
    AdminAuthModule,
    AdminRepositoryModule,
    AdminSessionRepositoryModule,
    AdminMfaChallengeRepositoryModule,
    AdminAuthProvidersModule,
  ],
  controllers: [SupportSessionController],
  providers: [
    AdminSessionGuard,
    RequireSuperAdminGuard,
    SupportSessionGuard,
    RequireElevatedSupportSessionGuard,
  ],
})
export class SupportSessionHttpModule {}
