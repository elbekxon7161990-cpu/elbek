import { Module } from '@nestjs/common';
import { AdminAuthModule, AdminUsersModule } from '@afa/application';
import {
  AdminAuthProvidersModule,
  AdminMfaChallengeRepositoryModule,
  AdminRepositoryModule,
  AdminSessionRepositoryModule,
  AuditLogRepositoryModule,
  UserRepositoryModule,
} from '@afa/infrastructure';

import { AdminSessionGuard } from '../admin-auth/admin-session.guard';
import { RequireAdminOrSuperAdminGuard } from '../rbac/require-admin-or-super-admin.guard';
import { AdminUsersController } from './admin-users.controller';

/**
 * Web admin panel — apps/api's own composition-root module, same shape as
 * `SupportSessionHttpModule`. Re-provides `AdminSessionGuard` here
 * (importing the SAME class, never a duplicate implementation) for the
 * identical reason every sibling http module already documents.
 */
@Module({
  imports: [
    AdminUsersModule,
    UserRepositoryModule,
    AuditLogRepositoryModule,
    AdminAuthModule,
    AdminRepositoryModule,
    AdminSessionRepositoryModule,
    AdminMfaChallengeRepositoryModule,
    AdminAuthProvidersModule,
  ],
  controllers: [AdminUsersController],
  providers: [AdminSessionGuard, RequireAdminOrSuperAdminGuard],
})
export class AdminUsersHttpModule {}
