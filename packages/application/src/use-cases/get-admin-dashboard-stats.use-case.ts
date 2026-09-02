import { Inject, Injectable } from '@nestjs/common';
import type { AdminDashboardStats, AdminDashboardStatsRepository } from '@afa/domain';
import { ADMIN_DASHBOARD_STATS_REPOSITORY } from '@afa/domain';

/** Thin pass-through — see `AdminDashboardStatsRepository`'s own doc comment for why this is scoped to user-status counts only. */
@Injectable()
export class GetAdminDashboardStatsUseCase {
  constructor(
    @Inject(ADMIN_DASHBOARD_STATS_REPOSITORY)
    private readonly statsRepository: AdminDashboardStatsRepository,
  ) {}

  async execute(): Promise<AdminDashboardStats> {
    return this.statsRepository.getStats();
  }
}
