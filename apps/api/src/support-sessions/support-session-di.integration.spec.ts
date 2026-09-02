import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  ApproveSupportSessionElevationUseCase,
  CloseSupportSessionElevationUseCase,
  CloseSupportSessionUseCase,
  ListMySupportSessionsUseCase,
  OpenSupportSessionUseCase,
  RequestSupportSessionElevationUseCase,
} from '@afa/application';
import {
  ADMIN_REPOSITORY,
  ADMIN_SESSION_REPOSITORY,
  SUPPORT_SESSION_ELEVATION_REPOSITORY,
  SUPPORT_SESSION_REPOSITORY,
  USER_REPOSITORY,
} from '@afa/domain';

import { AdminSessionGuard } from '../admin-auth/admin-session.guard';
import { RequireSuperAdminGuard } from '../rbac/require-super-admin.guard';
import { RequireElevatedSupportSessionGuard } from './require-elevated-support-session.guard';
import { SupportSessionController } from './support-session.controller';
import { SupportSessionGuard } from './support-session.guard';
import { SupportSessionHttpModule } from './support-session-http.module';

/**
 * TASK-SEC-006 — real NestJS DI resolution proof, same approach as
 * `admin-elevation-di.integration.spec.ts`. `.compile()` alone proves
 * provider RESOLUTION, not a live Postgres connection. Checks the
 * controller/guards' OWN injected fields are populated, not only that
 * `moduleRef.get(X)` independently resolves each class (the AUTH-002
 * lesson).
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.MFA_SECRET_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

describe('Support Session DI / composition-root wiring — real NestJS provider resolution', () => {
  it('resolves every support-session use case, the controller, and every guard, with every port token live and actually wired', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), SupportSessionHttpModule],
    }).compile();

    expect(moduleRef.get(OpenSupportSessionUseCase)).toBeInstanceOf(OpenSupportSessionUseCase);
    expect(moduleRef.get(CloseSupportSessionUseCase)).toBeInstanceOf(CloseSupportSessionUseCase);
    expect(moduleRef.get(RequestSupportSessionElevationUseCase)).toBeInstanceOf(
      RequestSupportSessionElevationUseCase,
    );
    expect(moduleRef.get(ApproveSupportSessionElevationUseCase)).toBeInstanceOf(
      ApproveSupportSessionElevationUseCase,
    );
    expect(moduleRef.get(CloseSupportSessionElevationUseCase)).toBeInstanceOf(
      CloseSupportSessionElevationUseCase,
    );
    expect(moduleRef.get(ListMySupportSessionsUseCase)).toBeInstanceOf(
      ListMySupportSessionsUseCase,
    );

    const controller = moduleRef.get(SupportSessionController);
    expect(controller).toBeInstanceOf(SupportSessionController);
    expect((controller as unknown as { openSession: unknown }).openSession).toBeDefined();
    expect((controller as unknown as { closeSession: unknown }).closeSession).toBeDefined();
    expect((controller as unknown as { requestElevation: unknown }).requestElevation).toBeDefined();
    expect((controller as unknown as { approveElevation: unknown }).approveElevation).toBeDefined();
    expect((controller as unknown as { closeElevation: unknown }).closeElevation).toBeDefined();
    expect((controller as unknown as { listMySessions: unknown }).listMySessions).toBeDefined();

    const sessionGuard = moduleRef.get(SupportSessionGuard);
    expect(sessionGuard).toBeInstanceOf(SupportSessionGuard);
    expect(
      (sessionGuard as unknown as { validateSupportSession: unknown }).validateSupportSession,
    ).toBeDefined();

    const elevatedGuard = moduleRef.get(RequireElevatedSupportSessionGuard);
    expect(elevatedGuard).toBeInstanceOf(RequireElevatedSupportSessionGuard);
    expect(
      (elevatedGuard as unknown as { requireElevated: unknown }).requireElevated,
    ).toBeDefined();

    expect(moduleRef.get(AdminSessionGuard)).toBeInstanceOf(AdminSessionGuard);
    expect(moduleRef.get(RequireSuperAdminGuard)).toBeInstanceOf(RequireSuperAdminGuard);

    expect(moduleRef.get(SUPPORT_SESSION_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(SUPPORT_SESSION_ELEVATION_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(USER_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(ADMIN_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(ADMIN_SESSION_REPOSITORY)).toBeDefined();

    await moduleRef.close();
  }, 30_000);
});
