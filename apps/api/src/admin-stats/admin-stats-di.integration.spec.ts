import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GetAdminDashboardStatsUseCase } from '@afa/application';
import {
  ADMIN_DASHBOARD_STATS_REPOSITORY,
  ADMIN_REPOSITORY,
  ADMIN_SESSION_REPOSITORY,
} from '@afa/domain';

import { AdminSessionGuard } from '../admin-auth/admin-session.guard';
import { AdminStatsController } from './admin-stats.controller';
import { AdminStatsHttpModule } from './admin-stats-http.module';

/**
 * Real NestJS DI resolution proof, same approach as
 * `admin-elevation-di.integration.spec.ts`. `.compile()` alone proves
 * provider RESOLUTION, not a live Postgres connection.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.MFA_SECRET_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

describe('Admin Stats DI / composition-root wiring — real NestJS provider resolution', () => {
  it('resolves the stats use case, the controller, and the guard, with every port token live and actually wired', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AdminStatsHttpModule],
    }).compile();

    expect(moduleRef.get(GetAdminDashboardStatsUseCase)).toBeInstanceOf(
      GetAdminDashboardStatsUseCase,
    );

    const controller = moduleRef.get(AdminStatsController);
    expect(controller).toBeInstanceOf(AdminStatsController);
    expect((controller as unknown as { getStats: unknown }).getStats).toBeDefined();

    expect(moduleRef.get(AdminSessionGuard)).toBeInstanceOf(AdminSessionGuard);

    expect(moduleRef.get(ADMIN_DASHBOARD_STATS_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(ADMIN_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(ADMIN_SESSION_REPOSITORY)).toBeDefined();

    await moduleRef.close();
  }, 30_000);
});
