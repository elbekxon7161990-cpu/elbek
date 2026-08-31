import { Module } from '@nestjs/common';

import { ApproveAdminElevationUseCase } from '../use-cases/approve-admin-elevation.use-case';
import { RequestAdminElevationUseCase } from '../use-cases/request-admin-elevation.use-case';

/**
 * TASK-AUTH-005 — the two elevation-approval use cases apps/api's `rbac`
 * controller/guard need. Does not bind any repository/port token — that is
 * the composition root's job (packages/infrastructure's
 * `AdminElevationRepositoryModule`/`AdminRepositoryModule`), same split
 * every other module in this package already established.
 */
@Module({
  providers: [RequestAdminElevationUseCase, ApproveAdminElevationUseCase],
  exports: [RequestAdminElevationUseCase, ApproveAdminElevationUseCase],
})
export class AdminElevationModule {}
