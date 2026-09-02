import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  BlockUserUseCase,
  GetUserByIdUseCase,
  ListUsersUseCase,
  UnblockUserUseCase,
} from '@afa/application';
import {
  ADMIN_REPOSITORY,
  ADMIN_SESSION_REPOSITORY,
  AUDIT_LOG_REPOSITORY,
  USER_REPOSITORY,
} from '@afa/domain';

import { AdminSessionGuard } from '../admin-auth/admin-session.guard';
import { RequireAdminOrSuperAdminGuard } from '../rbac/require-admin-or-super-admin.guard';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersHttpModule } from './admin-users-http.module';

/**
 * Real NestJS DI resolution proof, same approach as
 * `admin-elevation-di.integration.spec.ts`. `.compile()` alone proves
 * provider RESOLUTION, not a live Postgres connection.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.MFA_SECRET_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

describe('Admin Users DI / composition-root wiring — real NestJS provider resolution', () => {
  it('resolves every admin-users use case, the controller, and both guards, with every port token live and actually wired', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AdminUsersHttpModule],
    }).compile();

    expect(moduleRef.get(ListUsersUseCase)).toBeInstanceOf(ListUsersUseCase);
    expect(moduleRef.get(GetUserByIdUseCase)).toBeInstanceOf(GetUserByIdUseCase);
    expect(moduleRef.get(BlockUserUseCase)).toBeInstanceOf(BlockUserUseCase);
    expect(moduleRef.get(UnblockUserUseCase)).toBeInstanceOf(UnblockUserUseCase);

    const controller = moduleRef.get(AdminUsersController);
    expect(controller).toBeInstanceOf(AdminUsersController);
    expect((controller as unknown as { listUsers: unknown }).listUsers).toBeDefined();
    expect((controller as unknown as { getUserById: unknown }).getUserById).toBeDefined();
    expect((controller as unknown as { blockUser: unknown }).blockUser).toBeDefined();
    expect((controller as unknown as { unblockUser: unknown }).unblockUser).toBeDefined();

    expect(moduleRef.get(AdminSessionGuard)).toBeInstanceOf(AdminSessionGuard);
    expect(moduleRef.get(RequireAdminOrSuperAdminGuard)).toBeInstanceOf(
      RequireAdminOrSuperAdminGuard,
    );

    expect(moduleRef.get(USER_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(AUDIT_LOG_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(ADMIN_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(ADMIN_SESSION_REPOSITORY)).toBeDefined();

    await moduleRef.close();
  }, 30_000);
});
