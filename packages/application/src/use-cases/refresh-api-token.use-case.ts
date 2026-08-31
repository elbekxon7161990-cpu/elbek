import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ApiTokenRepository } from '@afa/domain';
import {
  API_TOKEN_ACCESS_LIFETIME_MS,
  API_TOKEN_REFRESH_LIFETIME_MS,
  API_TOKEN_REPOSITORY,
} from '@afa/domain';

import type { RefreshApiTokenInput } from '../dto/refresh-api-token.input';
import { InvalidRefreshTokenError } from '../errors/invalid-refresh-token.error';

export interface RefreshApiTokenResult {
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
 * TASK-AUTH-003 — refresh WITH rotation (the user's explicit Decision 2):
 * every successful refresh atomically revokes the presented refresh token
 * and mints a brand-new refresh + access pair; the old refresh token can
 * never be used again, by design or by a lost race — see
 * `ApiTokenRepository.consumeRefreshToken`'s own doc comment for the atomic
 * mechanism this relies on. Scope/clientIdentifier/rateLimitPerMinute are
 * carried forward unchanged from the token being rotated — FR-API-083: a
 * token's scope is fixed for its lifetime, a refresh never widens it.
 */
@Injectable()
export class RefreshApiTokenUseCase {
  constructor(@Inject(API_TOKEN_REPOSITORY) private readonly apiTokens: ApiTokenRepository) {}

  async execute(input: RefreshApiTokenInput): Promise<RefreshApiTokenResult> {
    const now = new Date();
    const tokenHash = hashToken(input.refreshToken);

    const oldRefresh = await this.apiTokens.findActiveByTokenHash(tokenHash, now, 'refresh');
    if (!oldRefresh) {
      throw new InvalidRefreshTokenError();
    }

    const won = await this.apiTokens.consumeRefreshToken(oldRefresh.id, now);
    if (!won) {
      // Lost the rotation race, or this is a replay of an already-used
      // refresh token — both reject identically (this task's own explicit
      // "replay/race: first successful rotation wins" instruction).
      throw new InvalidRefreshTokenError();
    }

    const rawNewRefreshToken = generateRawToken();
    const newRefresh = await this.apiTokens.create({
      clientIdentifier: oldRefresh.clientIdentifier,
      tokenType: 'refresh',
      tokenHash: hashToken(rawNewRefreshToken),
      scope: oldRefresh.scope,
      rateLimitPerMinute: oldRefresh.rateLimitPerMinute,
      parentTokenId: oldRefresh.id,
      expiresAt: new Date(now.getTime() + API_TOKEN_REFRESH_LIFETIME_MS),
    });

    const rawNewAccessToken = generateRawToken();
    const newAccess = await this.apiTokens.create({
      clientIdentifier: oldRefresh.clientIdentifier,
      tokenType: 'access',
      tokenHash: hashToken(rawNewAccessToken),
      scope: oldRefresh.scope,
      rateLimitPerMinute: oldRefresh.rateLimitPerMinute,
      parentTokenId: newRefresh.id,
      expiresAt: new Date(now.getTime() + API_TOKEN_ACCESS_LIFETIME_MS),
    });

    return {
      accessTokenId: newAccess.id,
      accessToken: rawNewAccessToken,
      accessTokenExpiresAt: newAccess.expiresAt,
      refreshTokenId: newRefresh.id,
      refreshToken: rawNewRefreshToken,
      refreshTokenExpiresAt: newRefresh.expiresAt,
    };
  }
}
