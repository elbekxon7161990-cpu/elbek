import { Global, Module } from '@nestjs/common';
import { ADMIN_DASHBOARD_STATS_REPOSITORY } from '@afa/domain';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaAdminDashboardStatsRepository } from './prisma-admin-dashboard-stats.repository';

/** Binds @afa/domain's ADMIN_DASHBOARD_STATS_REPOSITORY port to the Prisma implementation — same `@Global()` shape as `UserRepositoryModule`. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    { provide: ADMIN_DASHBOARD_STATS_REPOSITORY, useClass: PrismaAdminDashboardStatsRepository },
  ],
  exports: [ADMIN_DASHBOARD_STATS_REPOSITORY],
})
export class AdminDashboardStatsRepositoryModule {}
