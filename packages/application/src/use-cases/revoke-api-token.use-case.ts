import { Inject, Injectable } from '@nestjs/common';
import type { ApiTokenRepository } from '@afa/domain';
import { API_TOKEN_REPOSITORY } from '@afa/domain';

import { ApiTokenNotFoundError } from '../errors/api-token-not-found.error';

export interface RevokeApiTokenInput {
  apiTokenId: string;
}

/**
 * TASK-AUTH-003 — admin-triggered, single-row revoke (`DELETE
 * /admin/api-tokens/{id}`, `AdminSessionGuard`-protected). Deliberately does
 * NOT cascade to the token's own parent/children in the refresh chain — an
 * access token's own short lifetime (24h) is FR-AUTH-009's own stated
 * mitigation for a leaked/needing-revocation credential ("limiting the
 * blast radius... to its short validity window"), and this task's DoD is
 * specifically about the revoked token itself being rejected on its next
 * use, not a chain-wide cascade the PRD never asks for. A disclosed scope
 * boundary, not an oversight — revoking a refresh token stops that client
 * from minting further access tokens; any access token already issued from
 * it still runs out on its own short clock.
 */
@Injectable()
export class RevokeApiTokenUseCase {
  constructor(@Inject(API_TOKEN_REPOSITORY) private readonly apiTokens: ApiTokenRepository) {}

  async execute(input: RevokeApiTokenInput): Promise<void> {
    const existing = await this.apiTokens.findById(input.apiTokenId);
    if (!existing) {
      throw new ApiTokenNotFoundError(input.apiTokenId);
    }
    await this.apiTokens.revoke(input.apiTokenId, new Date());
  }
}
