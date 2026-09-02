import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GetAdminDashboardStatsUseCase } from '@afa/application';
import type { AdminDashboardStats } from '@afa/domain';

import { AdminSessionGuard } from '../admin-auth/admin-session.guard';

/** Web admin panel's dashboard summary — read-only, any authenticated admin. */
@ApiTags('admin-stats')
@Controller('admin/stats')
export class AdminStatsController {
  constructor(
    @Inject(GetAdminDashboardStatsUseCase)
    private readonly getStats: GetAdminDashboardStatsUseCase,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AdminSessionGuard)
  async get(): Promise<AdminDashboardStats> {
    return this.getStats.execute();
  }
}
