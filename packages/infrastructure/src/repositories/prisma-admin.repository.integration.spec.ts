import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaAdminRepository } from './prisma-admin.repository';

/**
 * Requires `docker compose up -d postgres` (packages/infrastructure/prisma's
 * migrations already applied, including
 * 20260823000000_admin_lockout_backoff_fields) — same precedent as
 * `PrismaUserRepository`'s own integration spec.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const TEST_EMAIL = 'integration-test-admin@example.invalid';

describe('PrismaAdminRepository (integration)', () => {
  const prisma = new PrismaService();
  const repository = new PrismaAdminRepository(prisma);

  beforeAll(async () => {
    await prisma.onModuleInit();
    // `contains` — this suite seeds several admins sharing TEST_EMAIL as a
    // suffix (`race-${TEST_EMAIL}`, `reset-${TEST_EMAIL}`), not just the
    // exact base email; also sweeps up any row an earlier interrupted run
    // (e.g. a timeout) left behind before its own inline cleanup ran.
    await prisma.admin.deleteMany({ where: { email: { contains: TEST_EMAIL } } });
  });

  afterAll(async () => {
    await prisma.admin.deleteMany({ where: { email: { contains: TEST_EMAIL } } });
    await prisma.onModuleDestroy();
  });

  it('creates, finds by email/id, and starts with zeroed lockout state', async () => {
    const created = await repository.create({
      email: TEST_EMAIL,
      passwordHash: 'argon2id$fake-hash-for-test',
      mfaSecretRef: 'v1.fake.reference.for-test',
      role: 'super_admin',
    });
    expect(created.email).toBe(TEST_EMAIL);
    expect(created.status).toBe('active');
    expect(created.failedLoginAttempts).toBe(0);
    expect(created.lockoutCycleCount).toBe(0);
    expect(created.lockedUntil).toBeNull();

    const byEmail = await repository.findByEmail(TEST_EMAIL);
    expect(byEmail?.id).toBe(created.id);
    const byId = await repository.findById(created.id);
    expect(byId?.email).toBe(TEST_EMAIL);
  });

  it('applyFailedLoginOutcome only writes when the expected prior state still matches (optimistic concurrency)', async () => {
    const admin = await repository.create({
      email: `race-${TEST_EMAIL}`,
      passwordHash: 'argon2id$fake-hash-for-test',
      mfaSecretRef: 'v1.fake.reference.for-test',
      role: 'admin',
    });

    const expected = {
      failedLoginAttempts: admin.failedLoginAttempts,
      failedLoginWindowStartedAt: admin.failedLoginWindowStartedAt,
      lockedUntil: admin.lockedUntil,
      lockoutCycleCount: admin.lockoutCycleCount,
    };
    const now = new Date();
    const next = {
      failedLoginAttempts: 1,
      failedLoginWindowStartedAt: now,
      lockedUntil: null,
      lockoutCycleCount: 0,
    };

    const firstWriter = await repository.applyFailedLoginOutcome(admin.id, expected, next);
    expect(firstWriter?.failedLoginAttempts).toBe(1);

    // Same stale `expected` — the row has already moved on, so this must lose the race.
    const secondWriter = await repository.applyFailedLoginOutcome(admin.id, expected, next);
    expect(secondWriter).toBeNull();

    await prisma.admin.delete({ where: { id: admin.id } });
  }, 20_000);

  it('resetLoginFailureState unconditionally zeroes every lockout field', async () => {
    const admin = await repository.create({
      email: `reset-${TEST_EMAIL}`,
      passwordHash: 'argon2id$fake-hash-for-test',
      mfaSecretRef: 'v1.fake.reference.for-test',
      role: 'admin',
    });
    await repository.applyFailedLoginOutcome(
      admin.id,
      {
        failedLoginAttempts: 0,
        failedLoginWindowStartedAt: null,
        lockedUntil: null,
        lockoutCycleCount: 0,
      },
      {
        failedLoginAttempts: 4,
        failedLoginWindowStartedAt: new Date(),
        lockedUntil: null,
        lockoutCycleCount: 2,
      },
    );

    const reset = await repository.resetLoginFailureState(admin.id);
    expect(reset.failedLoginAttempts).toBe(0);
    expect(reset.failedLoginWindowStartedAt).toBeNull();
    expect(reset.lockedUntil).toBeNull();
    expect(reset.lockoutCycleCount).toBe(0);

    await prisma.admin.delete({ where: { id: admin.id } });
  }, 20_000);
});
