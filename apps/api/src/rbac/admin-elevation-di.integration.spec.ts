import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ApproveAdminElevationUseCase, RequestAdminElevationUseCase } from '@afa/application';
import {
  ADMIN_ELEVATION_REPOSITORY,
  ADMIN_REPOSITORY,
  ADMIN_SESSION_REPOSITORY,
  AUDIT_LOG_REPOSITORY,
} from '@afa/domain';

import { AdminElevationController } from './admin-elevation.controller';
import { AdminElevationHttpModule } from './admin-elevation-http.module';
import { RequireSuperAdminGuard } from './require-super-admin.guard';
import { AdminSessionGuard } from '../admin-auth/admin-session.guard';

/**
 * TASK-AUTH-005 — real NestJS DI resolution proof, same approach as
 * `api-token-di.integration.spec.ts`. `.compile()` alone (no `.init()`)
 * proves provider RESOLUTION, not a live Postgres connection. Checks the
 * controller/guard's OWN injected fields are populated, not only that
 * `moduleRef.get(X)` independently resolves each class (the AUTH-002
 * lesson).
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.MFA_SECRET_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

describe('Admin Elevation DI / composition-root wiring — real NestJS provider resolution', () => {
  it('resolves every elevation use case, the controller, and both guards, with every port token live and actually wired', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AdminElevationHttpModule],
    }).compile();

    expect(moduleRef.get(RequestAdminElevationUseCase)).toBeInstanceOf(
      RequestAdminElevationUseCase,
    );
    expect(moduleRef.get(ApproveAdminElevationUseCase)).toBeInstanceOf(
      ApproveAdminElevationUseCase,
    );

    const controller = moduleRef.get(AdminElevationController);
    expect(controller).toBeInstanceOf(AdminElevationController);
    expect((controller as unknown as { requestElevation: unknown }).requestElevation).toBeDefined();
    expect((controller as unknown as { approveElevation: unknown }).approveElevation).toBeDefined();

    const sessionGuard = moduleRef.get(AdminSessionGuard);
    expect(sessionGuard).toBeInstanceOf(AdminSessionGuard);
    expect(
      (sessionGuard as unknown as { validateAdminSession: unknown }).validateAdminSession,
    ).toBeDefined();

    expect(moduleRef.get(RequireSuperAdminGuard)).toBeInstanceOf(RequireSuperAdminGuard);

    expect(moduleRef.get(ADMIN_ELEVATION_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(AUDIT_LOG_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(ADMIN_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(ADMIN_SESSION_REPOSITORY)).toBeDefined();

    await moduleRef.close();
  }, 30_000);
});
