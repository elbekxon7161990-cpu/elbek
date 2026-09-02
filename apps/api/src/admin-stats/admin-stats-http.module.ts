import { Module } from '@nestjs/common';
import { AdminAuthModule, AdminStatsModule } from '@afa/application';
import {
  AdminAuthProvidersModule,
  AdminDashboardStatsRepositoryModule,
  AdminMfaChallengeRepositoryModule,
  AdminRepositoryModule,
  AdminSessionRepositoryModule,
} from '@afa/infrastructure';

import { AdminSessionGuard } from '../admin-auth/admin-session.guard';
import { AdminStatsController } from './admin-stats.controller';

/** Web admin panel — apps/api's own composition-root module, same shape as `AdminUsersHttpModule`. */
@Module({
  imports: [
    AdminStatsModule,
    AdminDashboardStatsRepositoryModule,
    AdminAuthModule,
    AdminRepositoryModule,
    AdminSessionRepositoryModule,
    AdminMfaChallengeRepositoryModule,
    AdminAuthProvidersModule,
  ],
  controllers: [AdminStatsController],
  providers: [AdminSessionGuard],
})
export class AdminStatsHttpModule {}
