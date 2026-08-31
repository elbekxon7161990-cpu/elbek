import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  IssueApiTokenUseCase,
  RefreshApiTokenUseCase,
  RevokeApiTokenUseCase,
  ValidateApiTokenUseCase,
} from '@afa/application';
import { ADMIN_REPOSITORY, ADMIN_SESSION_REPOSITORY, API_TOKEN_REPOSITORY } from '@afa/domain';

import { ApiTokenHttpModule } from './api-token-http.module';
import { ApiTokenController } from './api-token.controller';
import { ApiTokenGuard } from './api-token.guard';

/**
 * TASK-AUTH-003 — real NestJS DI resolution proof, same approach as
 * `admin-auth-di.integration.spec.ts`. `.compile()` alone (no `.init()`)
 * proves provider RESOLUTION, not a live Postgres connection. Strengthened
 * per the AUTH-002 lesson: also checks the controller/guard's OWN injected
 * fields are populated, not only that `moduleRef.get(X)` independently
 * resolves each class.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.MFA_SECRET_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

describe('API Token DI / composition-root wiring — real NestJS provider resolution', () => {
  it('resolves every api-token use case, the controller, and the guard, with every port token live and actually wired', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), ApiTokenHttpModule],
    }).compile();

    expect(moduleRef.get(IssueApiTokenUseCase)).toBeInstanceOf(IssueApiTokenUseCase);
    expect(moduleRef.get(RefreshApiTokenUseCase)).toBeInstanceOf(RefreshApiTokenUseCase);
    expect(moduleRef.get(RevokeApiTokenUseCase)).toBeInstanceOf(RevokeApiTokenUseCase);
    expect(moduleRef.get(ValidateApiTokenUseCase)).toBeInstanceOf(ValidateApiTokenUseCase);

    const controller = moduleRef.get(ApiTokenController);
    expect(controller).toBeInstanceOf(ApiTokenController);
    expect((controller as unknown as { issueApiToken: unknown }).issueApiToken).toBeDefined();
    expect((controller as unknown as { refreshApiToken: unknown }).refreshApiToken).toBeDefined();
    expect((controller as unknown as { revokeApiToken: unknown }).revokeApiToken).toBeDefined();

    const guard = moduleRef.get(ApiTokenGuard);
    expect(guard).toBeInstanceOf(ApiTokenGuard);
    expect((guard as unknown as { validateApiToken: unknown }).validateApiToken).toBeDefined();

    expect(moduleRef.get(API_TOKEN_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(ADMIN_REPOSITORY)).toBeDefined();
    expect(moduleRef.get(ADMIN_SESSION_REPOSITORY)).toBeDefined();

    await moduleRef.close();
  }, 30_000);
});
