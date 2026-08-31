import type { ApiToken, ApiTokenRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvalidRefreshTokenError } from '../errors/invalid-refresh-token.error';
import { RefreshApiTokenUseCase } from './refresh-api-token.use-case';

function makeToken(overrides: Partial<ApiToken> = {}): ApiToken {
  return {
    id: 'refresh-1',
    clientIdentifier: 'client-a',
    tokenType: 'refresh',
    tokenHash: 'hash',
    scope: ['transactions:read', 'budgets:write'],
    rateLimitPerMinute: 60,
    parentTokenId: null,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as ApiToken;
}

describe('RefreshApiTokenUseCase', () => {
  let apiTokens: {
    findActiveByTokenHash: ReturnType<typeof vi.fn>;
    consumeRefreshToken: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let useCase: RefreshApiTokenUseCase;

  beforeEach(() => {
    apiTokens = {
      findActiveByTokenHash: vi.fn(),
      consumeRefreshToken: vi.fn(),
      create: vi.fn(),
    };
    useCase = new RefreshApiTokenUseCase(apiTokens as unknown as ApiTokenRepository);
  });

  it('rotates: consumes the old refresh token and mints a new refresh+access pair carrying the SAME scope/client/rate-limit', async () => {
    const oldRefresh = makeToken();
    apiTokens.findActiveByTokenHash.mockResolvedValue(oldRefresh);
    apiTokens.consumeRefreshToken.mockResolvedValue(true);
    const newRefreshRow = makeToken({ id: 'refresh-2', parentTokenId: 'refresh-1' });
    const newAccessRow = makeToken({
      id: 'access-2',
      tokenType: 'access',
      parentTokenId: 'refresh-2',
    });
    apiTokens.create.mockResolvedValueOnce(newRefreshRow).mockResolvedValueOnce(newAccessRow);

    const result = await useCase.execute({ refreshToken: 'raw-old-refresh-token' });

    expect(apiTokens.consumeRefreshToken).toHaveBeenCalledWith('refresh-1', expect.any(Date));
    const [refreshCall, accessCall] = apiTokens.create.mock.calls;
    expect(refreshCall[0]).toMatchObject({
      tokenType: 'refresh',
      parentTokenId: 'refresh-1',
      clientIdentifier: 'client-a',
      scope: ['transactions:read', 'budgets:write'],
      rateLimitPerMinute: 60,
    });
    expect(accessCall[0]).toMatchObject({
      tokenType: 'access',
      parentTokenId: 'refresh-2',
      scope: ['transactions:read', 'budgets:write'],
    });
    expect(result.refreshToken).not.toBe('raw-old-refresh-token');
    expect(result.accessToken).toBeTypeOf('string');
  });

  it('rejects an unknown/expired/wrong-type refresh token generically, without consuming anything', async () => {
    apiTokens.findActiveByTokenHash.mockResolvedValue(null);
    await expect(useCase.execute({ refreshToken: 'bogus' })).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
    expect(apiTokens.consumeRefreshToken).not.toHaveBeenCalled();
    expect(apiTokens.create).not.toHaveBeenCalled();
  });

  it('rejects generically when it loses the atomic-consume race (concurrent rotation or replay of an already-used token)', async () => {
    apiTokens.findActiveByTokenHash.mockResolvedValue(makeToken());
    apiTokens.consumeRefreshToken.mockResolvedValue(false);

    await expect(useCase.execute({ refreshToken: 'raw-old-refresh-token' })).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
    expect(apiTokens.create).not.toHaveBeenCalled();
  });
});
