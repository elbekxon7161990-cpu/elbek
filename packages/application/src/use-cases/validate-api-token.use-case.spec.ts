import type { ApiToken, ApiTokenRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiTokenInvalidError } from '../errors/api-token-invalid.error';
import { ValidateApiTokenUseCase } from './validate-api-token.use-case';

describe('ValidateApiTokenUseCase', () => {
  let apiTokens: { findActiveByTokenHash: ReturnType<typeof vi.fn> };
  let useCase: ValidateApiTokenUseCase;

  beforeEach(() => {
    apiTokens = { findActiveByTokenHash: vi.fn() };
    useCase = new ValidateApiTokenUseCase(apiTokens as unknown as ApiTokenRepository);
  });

  it('resolves the token for a live, active access token', async () => {
    const token = { id: 'access-1' } as ApiToken;
    apiTokens.findActiveByTokenHash.mockResolvedValue(token);

    const result = await useCase.execute('raw-token');

    expect(result).toBe(token);
    expect(apiTokens.findActiveByTokenHash).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Date),
      'access',
    );
  });

  it('rejects generically when no active access token matches (missing, revoked, expired, or a refresh token presented here)', async () => {
    apiTokens.findActiveByTokenHash.mockResolvedValue(null);
    await expect(useCase.execute('bogus')).rejects.toBeInstanceOf(ApiTokenInvalidError);
  });
});
