import type { ApiToken, ApiTokenRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvalidApiTokenScopeError } from '../errors/invalid-api-token-scope.error';
import { IssueApiTokenUseCase } from './issue-api-token.use-case';

function makeToken(overrides: Partial<ApiToken> = {}): ApiToken {
  return {
    id: 'token-1',
    clientIdentifier: 'client-a',
    tokenType: 'refresh',
    tokenHash: 'hash',
    scope: ['transactions:read'],
    rateLimitPerMinute: 60,
    parentTokenId: null,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as ApiToken;
}

describe('IssueApiTokenUseCase', () => {
  let apiTokens: { create: ReturnType<typeof vi.fn> };
  let useCase: IssueApiTokenUseCase;

  beforeEach(() => {
    apiTokens = { create: vi.fn() };
    useCase = new IssueApiTokenUseCase(apiTokens as unknown as ApiTokenRepository);
  });

  it('creates a refresh token then an access token whose parentTokenId references it, using the default rate limit', async () => {
    const refreshRow = makeToken({ id: 'refresh-1', tokenType: 'refresh' });
    const accessRow = makeToken({
      id: 'access-1',
      tokenType: 'access',
      parentTokenId: 'refresh-1',
    });
    apiTokens.create.mockResolvedValueOnce(refreshRow).mockResolvedValueOnce(accessRow);

    const result = await useCase.execute({
      clientIdentifier: 'client-a',
      scope: ['transactions:read', 'budgets:read'],
    });

    expect(apiTokens.create).toHaveBeenCalledTimes(2);
    const [refreshCall, accessCall] = apiTokens.create.mock.calls;
    expect(refreshCall[0]).toMatchObject({
      clientIdentifier: 'client-a',
      tokenType: 'refresh',
      parentTokenId: null,
      rateLimitPerMinute: 60,
      scope: ['transactions:read', 'budgets:read'],
    });
    expect(accessCall[0]).toMatchObject({
      clientIdentifier: 'client-a',
      tokenType: 'access',
      parentTokenId: 'refresh-1',
      rateLimitPerMinute: 60,
      scope: ['transactions:read', 'budgets:read'],
    });
    expect(result.accessToken).not.toBe(result.refreshToken);
    expect(result.accessToken.length).toBeGreaterThan(0);
  });

  it('honors an explicit rateLimitPerMinute override', async () => {
    apiTokens.create.mockResolvedValueOnce(makeToken()).mockResolvedValueOnce(makeToken());
    await useCase.execute({
      clientIdentifier: 'client-a',
      scope: ['transactions:read'],
      rateLimitPerMinute: 120,
    });
    expect(apiTokens.create.mock.calls[0][0]).toMatchObject({ rateLimitPerMinute: 120 });
  });

  it('rejects an empty scope array before touching the repository', async () => {
    await expect(
      useCase.execute({ clientIdentifier: 'client-a', scope: [] }),
    ).rejects.toBeInstanceOf(InvalidApiTokenScopeError);
    expect(apiTokens.create).not.toHaveBeenCalled();
  });

  it('rejects a malformed scope entry before touching the repository', async () => {
    await expect(
      useCase.execute({
        clientIdentifier: 'client-a',
        scope: ['transactions:read', 'not a scope'],
      }),
    ).rejects.toBeInstanceOf(InvalidApiTokenScopeError);
    expect(apiTokens.create).not.toHaveBeenCalled();
  });
});
