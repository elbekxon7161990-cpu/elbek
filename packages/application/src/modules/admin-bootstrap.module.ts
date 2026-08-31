import { Module } from '@nestjs/common';

import { BootstrapAdminUseCase } from '../use-cases/bootstrap-admin.use-case';

/**
 * TASK-AUTH-002 Decision 4 — kept separate from `AdminAuthModule` so
 * apps/api's normal HTTP runtime never needs `BREACHED_PASSWORD_CHECKER`
 * resolvable in its DI graph just to serve login requests; only the
 * `admin-bootstrap` CLI script imports this module. Same NestJS
 * eager-resolution reasoning `AccountDeletionModule`'s own doc comment
 * documents for keeping `PurgeExpiredAccountsUseCase` out of that module.
 */
@Module({
  providers: [BootstrapAdminUseCase],
  exports: [BootstrapAdminUseCase],
})
export class AdminBootstrapModule {}
