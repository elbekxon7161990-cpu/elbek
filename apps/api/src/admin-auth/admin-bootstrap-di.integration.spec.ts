import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AdminBootstrapModule, BootstrapAdminUseCase } from '@afa/application';
import { AdminAuthProvidersModule, AdminRepositoryModule } from '@afa/infrastructure';
import { ADMIN_REPOSITORY, PASSWORD_HASHER, SECRET_STORE, TOTP_PROVIDER } from '@afa/domain';

process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.MFA_SECRET_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

/**
 * TASK-AUTH-002 Decision 4 — real DI resolution proof for the exact module
 * graph `admin-bootstrap.ts`'s CLI wires, isolated from `AdminAuthHttpModule`
 * (this is deliberately the ONLY place `BREACHED_PASSWORD_CHECKER` needs to
 * resolve — see `AdminBootstrapModule`'s own doc comment for why it is kept
 * out of the HTTP app's module graph).
 */
describe('Admin Bootstrap DI / composition-root wiring — real NestJS provider resolution', () => {
  it('resolves BootstrapAdminUseCase with every port token live', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        AdminRepositoryModule,
        AdminAuthProvidersModule,
        AdminBootstrapModule,
      ],
    }).compile();

    expect(moduleRef.get(BootstrapAdminUseCase)).toBeInstanceOf(BootstrapAdminUseCase);
    expect(moduleRef.get(ADMIN_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(PASSWORD_HASHER)).toBeDefined();
    expect(moduleRef.get(TOTP_PROVIDER)).toBeDefined();
    expect(moduleRef.get(SECRET_STORE)).toBeDefined();

    await moduleRef.close();
  }, 30_000);
});
