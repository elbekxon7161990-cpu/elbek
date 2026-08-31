import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaApiTokenRepository } from './prisma-api-token.repository';

/**
 * Requires real Postgres — same precedent as `prisma-admin.repository.integration.spec.ts`.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const TEST_CLIENT = 'integration-test-client-auth003';

describe('PrismaApiTokenRepository (integration)', () => {
  const prisma = new PrismaService();
  const repository = new PrismaApiTokenRepository(prisma);

  beforeAll(async () => {
    await prisma.onModuleInit();
    await prisma.apiToken.deleteMany({ where: { clientIdentifier: { contains: TEST_CLIENT } } });
  });

  afterAll(async () => {
    await prisma.apiToken.deleteMany({ where: { clientIdentifier: { contains: TEST_CLIENT } } });
    await prisma.onModuleDestroy();
  });

  it('creates a refresh token then an access token referencing it via parentTokenId, and finds each by hash', async () => {
    const refresh = await repository.create({
      clientIdentifier: TEST_CLIENT,
      tokenType: 'refresh',
      tokenHash: 'hash-refresh-1',
      scope: ['transactions:read'],
      rateLimitPerMinute: 60,
      parentTokenId: null,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    expect(refresh.parentTokenId).toBeNull();
    expect(refresh.revokedAt).toBeNull();

    const access = await repository.create({
      clientIdentifier: TEST_CLIENT,
      tokenType: 'access',
      tokenHash: 'hash-access-1',
      scope: ['transactions:read'],
      rateLimitPerMinute: 60,
      parentTokenId: refresh.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    expect(access.parentTokenId).toBe(refresh.id);

    const foundAccess = await repository.findActiveByTokenHash(
      'hash-access-1',
      new Date(),
      'access',
    );
    expect(foundAccess?.id).toBe(access.id);

    // A refresh-type row is never returned when filtering for 'access'.
    const wrongType = await repository.findActiveByTokenHash(
      'hash-refresh-1',
      new Date(),
      'access',
    );
    expect(wrongType).toBeNull();

    const foundRefresh = await repository.findActiveByTokenHash(
      'hash-refresh-1',
      new Date(),
      'refresh',
    );
    expect(foundRefresh?.id).toBe(refresh.id);
  }, 20_000);

  it('excludes an expired row from findActiveByTokenHash', async () => {
    await repository.create({
      clientIdentifier: TEST_CLIENT,
      tokenType: 'access',
      tokenHash: 'hash-expired-1',
      scope: ['transactions:read'],
      rateLimitPerMinute: 60,
      parentTokenId: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    const found = await repository.findActiveByTokenHash('hash-expired-1', new Date());
    expect(found).toBeNull();
  }, 20_000);

  it('excludes a revoked row from findActiveByTokenHash', async () => {
    const token = await repository.create({
      clientIdentifier: TEST_CLIENT,
      tokenType: 'access',
      tokenHash: 'hash-revoked-1',
      scope: ['transactions:read'],
      rateLimitPerMinute: 60,
      parentTokenId: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await repository.revoke(token.id, new Date());
    const found = await repository.findActiveByTokenHash('hash-revoked-1', new Date());
    expect(found).toBeNull();
  }, 20_000);

  it('revoke is idempotent — revoking an already-revoked row is a safe no-op', async () => {
    const token = await repository.create({
      clientIdentifier: TEST_CLIENT,
      tokenType: 'access',
      tokenHash: 'hash-idempotent-1',
      scope: ['transactions:read'],
      rateLimitPerMinute: 60,
      parentTokenId: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await repository.revoke(token.id, new Date());
    await expect(repository.revoke(token.id, new Date())).resolves.toBeUndefined();
  }, 20_000);

  it('consumeRefreshToken: exactly one of two concurrent callers wins the race, the loser gets false', async () => {
    const refresh = await repository.create({
      clientIdentifier: TEST_CLIENT,
      tokenType: 'refresh',
      tokenHash: 'hash-race-1',
      scope: ['transactions:read'],
      rateLimitPerMinute: 60,
      parentTokenId: null,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const now = new Date();
    const [resultA, resultB] = await Promise.all([
      repository.consumeRefreshToken(refresh.id, now),
      repository.consumeRefreshToken(refresh.id, now),
    ]);
    const winners = [resultA, resultB].filter(Boolean);
    expect(winners).toHaveLength(1);

    // A third, later call also loses — the row is already revoked (replay).
    const thirdAttempt = await repository.consumeRefreshToken(refresh.id, new Date());
    expect(thirdAttempt).toBe(false);
  }, 20_000);
});
