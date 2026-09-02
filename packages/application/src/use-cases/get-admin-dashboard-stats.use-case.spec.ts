import { describe, expect, it, vi } from 'vitest';
import type { AdminDashboardStats, AdminDashboardStatsRepository } from '@afa/domain';

import { GetAdminDashboardStatsUseCase } from './get-admin-dashboard-stats.use-case';

describe('GetAdminDashboardStatsUseCase', () => {
  it('returns whatever the repository reports, unchanged', async () => {
    const stats: AdminDashboardStats = {
      totalUsers: 10,
      activeUsers: 7,
      deactivatedUsers: 2,
      pendingDeletionUsers: 1,
    };
    const repo: AdminDashboardStatsRepository = { getStats: vi.fn().mockResolvedValue(stats) };
    const useCase = new GetAdminDashboardStatsUseCase(repo);

    const result = await useCase.execute();

    expect(result).toEqual(stats);
  });
});
