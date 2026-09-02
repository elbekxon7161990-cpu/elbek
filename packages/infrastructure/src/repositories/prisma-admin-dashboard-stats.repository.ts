import { Injectable } from '@nestjs/common';
import type { AdminDashboardStats, AdminDashboardStatsRepository } from '@afa/domain';

import { PrismaService } from '../prisma/prisma.service';

/**
 * `User` is not RLS-protected (`rls-protected-models.ts`'s own exclusion
 * list), so these counts are safe to run via the normal, unextended
 * `PrismaService` with no per-user context — see
 * `AdminDashboardStatsRepository`'s own doc comment for why this
 * repository is deliberately scoped to user-status counts only.
 */
@Injectable()
export class PrismaAdminDashboardStatsRepository implements AdminDashboardStatsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(): Promise<AdminDashboardStats> {
    const [totalUsers, activeUsers, deactivatedUsers, pendingDeletionUsers] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.user.count({ where: { status: 'deactivated' } }),
      this.prisma.user.count({ where: { status: 'pending_deletion' } }),
    ]);
    return { totalUsers, activeUsers, deactivatedUsers, pendingDeletionUsers };
  }
}
