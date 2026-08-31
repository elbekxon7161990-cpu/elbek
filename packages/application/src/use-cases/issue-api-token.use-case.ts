import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ApiTokenRepository } from '@afa/domain';
import {
  API_TOKEN_ACCESS_LIFETIME_MS,
  API_TOKEN_DEFAULT_RATE_LIMIT_PER_MINUTE,
  API_TOKEN_REFRESH_LIFETIME_MS,
  API_TOKEN_REPOSITORY,
  isValidApiTokenScope,
} from '@afa/domain';

import type { IssueApiTokenInput } from '../dto/issue-api-token.input';
import { InvalidApiTokenScopeError } from '../errors/invalid-api-token-scope.error';

export interface IssueApiTokenResult {
  clientIdentifier: string;
  scope: string[];
  /** The issued row's own id — needed to later call `DELETE /admin/api-tokens/{id}`; never the secret itself. */
  accessTokenId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenId: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

function generateRawToken(): string {
  return randomBytes(32).toString('hex');
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * TASK-AUTH-003 (§7.7.4 Issuance row, FR-AUTH-009) — internal token-issuance
 * flow, never self-service (no route in apps/api calls this except the
 * admin-guarded `POST /admin/api-tokens`). Creates a refresh token (root of
 * a new chain, `parentTokenId = null`) and, in the same call, the first
 * access token issued from it (`parentTokenId = refresh.id`) — the pairing
 * §7.7.4's own "Refresh" row describes ("a short-lived access token...
 * paired with a longer-lived refresh token").
 */
@Injectable()
export class IssueApiTokenUseCase {
  constructor(@Inject(API_TOKEN_REPOSITORY) private readonly apiTokens: ApiTokenRepository) {}

  async execute(input: IssueApiTokenInput): Promise<IssueApiTokenResult> {
    if (input.scope.length === 0) {
      throw new InvalidApiTokenScopeError('(empty scope array)');
    }
    for (const scope of input.scope) {
      if (!isValidApiTokenScope(scope)) {
        throw new InvalidApiTokenScopeError(scope);
      }
    }

    const now = new Date();
    const rateLimitPerMinute = input.rateLimitPerMinute ?? API_TOKEN_DEFAULT_RATE_LIMIT_PER_MINUTE;

    const rawRefreshToken = generateRawToken();
    const refresh = await this.apiTokens.create({
      clientIdentifier: input.clientIdentifier,
      tokenType: 'refresh',
      tokenHash: hashToken(rawRefreshToken),
      scope: input.scope,
      rateLimitPerMinute,
      parentTokenId: null,
      expiresAt: new Date(now.getTime() + API_TOKEN_REFRESH_LIFETIME_MS),
    });

    const rawAccessToken = generateRawToken();
    const access = await this.apiTokens.create({
      clientIdentifier: input.clientIdentifier,
      tokenType: 'access',
      tokenHash: hashToken(rawAccessToken),
      scope: input.scope,
      rateLimitPerMinute,
      parentTokenId: refresh.id,
      expiresAt: new Date(now.getTime() + API_TOKEN_ACCESS_LIFETIME_MS),
    });

    return {
      clientIdentifier: input.clientIdentifier,
      scope: input.scope,
      accessTokenId: access.id,
      accessToken: rawAccessToken,
      accessTokenExpiresAt: access.expiresAt,
      refreshTokenId: refresh.id,
      refreshToken: rawRefreshToken,
      refreshTokenExpiresAt: refresh.expiresAt,
    };
  }
}
