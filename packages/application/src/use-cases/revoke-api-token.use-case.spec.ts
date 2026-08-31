import type { ApiToken, ApiTokenRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiTokenNotFoundError } from '../errors/api-token-not-found.error';
import { RevokeApiTokenUseCase } from './revoke-api-token.use-case';

describe('RevokeApiTokenUseCase', () => {
  let apiTokens: { findById: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> };
  let useCase: RevokeApiTokenUseCase;

  beforeEach(() => {
    apiTokens = { findById: vi.fn(), revoke: vi.fn() };
    useCase = new RevokeApiTokenUseCase(apiTokens as unknown as ApiTokenRepository);
  });

  it('revokes an existing token', async () => {
    apiTokens.findById.mockResolvedValue({ id: 'token-1' } as ApiToken);
    await useCase.execute({ apiTokenId: 'token-1' });
    expect(apiTokens.revoke).toHaveBeenCalledWith('token-1', expect.any(Date));
  });

  it('throws for a nonexistent token id without calling revoke', async () => {
    apiTokens.findById.mockResolvedValue(null);
    await expect(useCase.execute({ apiTokenId: 'missing' })).rejects.toBeInstanceOf(
      ApiTokenNotFoundError,
    );
    expect(apiTokens.revoke).not.toHaveBeenCalled();
  });
});
