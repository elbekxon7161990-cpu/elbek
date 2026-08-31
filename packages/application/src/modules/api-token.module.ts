import { Module } from '@nestjs/common';

import { IssueApiTokenUseCase } from '../use-cases/issue-api-token.use-case';
import { RefreshApiTokenUseCase } from '../use-cases/refresh-api-token.use-case';
import { RevokeApiTokenUseCase } from '../use-cases/revoke-api-token.use-case';
import { ValidateApiTokenUseCase } from '../use-cases/validate-api-token.use-case';

/**
 * TASK-AUTH-003 — all four use cases in one module (unlike AUTH-002's
 * `AdminAuthModule`/`AdminBootstrapModule` split): every one of these is
 * consumed by the SAME `apps/api` HTTP surface (issue/refresh/revoke are
 * admin- or token-guarded endpoints, validate backs `ApiTokenGuard`), so
 * there is no NestJS eager-resolution reason to separate them.
 */
@Module({
  providers: [
    IssueApiTokenUseCase,
    RefreshApiTokenUseCase,
    RevokeApiTokenUseCase,
    ValidateApiTokenUseCase,
  ],
  exports: [
    IssueApiTokenUseCase,
    RefreshApiTokenUseCase,
    RevokeApiTokenUseCase,
    ValidateApiTokenUseCase,
  ],
})
export class ApiTokenModule {}
