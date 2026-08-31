import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ApiToken, ApiTokenRepository } from '@afa/domain';
import { API_TOKEN_REPOSITORY } from '@afa/domain';

import { ApiTokenInvalidError } from '../errors/api-token-invalid.error';

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * TASK-AUTH-003 — the per-request check behind `ApiTokenGuard` (apps/api).
 * FR-AUTH-010/FR-API-082: revocation checked on every request against a
 * fast-lookup list (the `tokenHash` unique index + `(expires_at,
 * revoked_at)` index already on `api_tokens`), never relying solely on
 * expiry. Only ever matches `tokenType: 'access'` — a refresh token must
 * never authenticate an ordinary protected route, only the refresh
 * endpoint itself.
 */
@Injectable()
export class ValidateApiTokenUseCase {
  constructor(@Inject(API_TOKEN_REPOSITORY) private readonly apiTokens: ApiTokenRepository) {}

  async execute(rawToken: string): Promise<ApiToken> {
    const tokenHash = hashToken(rawToken);
    const token = await this.apiTokens.findActiveByTokenHash(tokenHash, new Date(), 'access');
    if (!token) {
      throw new ApiTokenInvalidError();
    }
    return token;
  }
}
