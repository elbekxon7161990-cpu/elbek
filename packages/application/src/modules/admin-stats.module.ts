import { Module } from '@nestjs/common';

import { GetAdminDashboardStatsUseCase } from '../use-cases/get-admin-dashboard-stats.use-case';

/** Web admin panel's dashboard-stats use case. */
@Module({
  providers: [GetAdminDashboardStatsUseCase],
  exports: [GetAdminDashboardStatsUseCase],
})
export class AdminStatsModule {}
