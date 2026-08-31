import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AdminLoginPasswordStepUseCase,
  AdminLogoutUseCase,
  AdminMfaVerificationUseCase,
  ValidateAdminSessionUseCase,
} from '@afa/application';
import {
  ADMIN_MFA_CHALLENGE_REPOSITORY,
  ADMIN_REPOSITORY,
  ADMIN_SESSION_REPOSITORY,
  BREACHED_PASSWORD_CHECKER,
  PASSWORD_HASHER,
  SECRET_STORE,
  TOTP_PROVIDER,
} from '@afa/domain';

import { AdminAuthHttpModule } from './admin-auth-http.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminSessionGuard } from './admin-session.guard';

/**
 * TASK-AUTH-002 — real NestJS DI resolution proof, same approach as
 * `account-deletion-di.integration.spec.ts`: isolates the exact module
 * graph `AppModule` wires for admin auth (`AdminAuthHttpModule`) rather
 * than bootstrapping the full app. Every module/provider here is the REAL
 * production one — no mocks, no fakes. `.compile()` alone (no `.init()`)
 * proves provider RESOLUTION, not a live Postgres/Redis connection.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.MFA_SECRET_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

describe('Admin Auth DI / composition-root wiring — real NestJS provider resolution', () => {
  it('resolves every admin-auth use case, the controller, and the guard, with every port token live', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AdminAuthHttpModule],
    }).compile();

    expect(moduleRef.get(AdminLoginPasswordStepUseCase)).toBeInstanceOf(
      AdminLoginPasswordStepUseCase,
    );
    expect(moduleRef.get(AdminMfaVerificationUseCase)).toBeInstanceOf(AdminMfaVerificationUseCase);
    expect(moduleRef.get(ValidateAdminSessionUseCase)).toBeInstanceOf(ValidateAdminSessionUseCase);
    expect(moduleRef.get(AdminLogoutUseCase)).toBeInstanceOf(AdminLogoutUseCase);
    const controller = moduleRef.get(AdminAuthController);
    expect(controller).toBeInstanceOf(AdminAuthController);
    // DIAGNOSTIC (TASK-AUTH-002) — moduleRef.get(X) resolving does not by
    // itself prove X was actually wired into ANOTHER provider's
    // constructor; check the controller's own injected fields directly.
    expect(
      (controller as unknown as { loginPasswordStep: unknown }).loginPasswordStep,
    ).toBeDefined();
    expect((controller as unknown as { mfaVerification: unknown }).mfaVerification).toBeDefined();
    // TASK-AUTH-004
    expect((controller as unknown as { logoutUseCase: unknown }).logoutUseCase).toBeDefined();
    const guard = moduleRef.get(AdminSessionGuard);
    expect(guard).toBeInstanceOf(AdminSessionGuard);
    expect(
      (guard as unknown as { validateAdminSession: unknown }).validateAdminSession,
    ).toBeDefined();

    expect(moduleRef.get(ADMIN_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(ADMIN_SESSION_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(ADMIN_MFA_CHALLENGE_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(PASSWORD_HASHER)).toBeDefined();
    expect(moduleRef.get(TOTP_PROVIDER)).toBeDefined();
    expect(moduleRef.get(SECRET_STORE)).toBeDefined();
    expect(moduleRef.get(BREACHED_PASSWORD_CHECKER)).toBeDefined();

    await moduleRef.close();
  }, 30_000);
});
