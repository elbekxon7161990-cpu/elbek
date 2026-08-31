import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaAdminRepository } from './prisma-admin.repository';
import { PrismaAdminSessionRepository } from './prisma-admin-session.repository';

process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const TEST_EMAIL = 'integration-test-admin-session@example.invalid';

describe('PrismaAdminSessionRepository (integration)', () => {
  const prisma = new PrismaService();
  const adminRepository = new PrismaAdminRepository(prisma);
  const sessionRepository = new PrismaAdminSessionRepository(prisma);

  beforeAll(async () => {
    await prisma.onModuleInit();
    // `contains` — this suite seeds several admins sharing TEST_EMAIL as a
    // suffix (`expired-${TEST_EMAIL}`, `touch-${TEST_EMAIL}`), not just the
    // exact base email. Sessions deleted first — `admin_sessions.admin_id`
    // has no ON DELETE CASCADE (schema.prisma's deliberate no-hard-cascade
    // posture, §13.14), so the parent `admin` row can't be deleted first.
    await prisma.adminSession.deleteMany({ where: { admin: { email: { contains: TEST_EMAIL } } } });
    await prisma.admin.deleteMany({ where: { email: { contains: TEST_EMAIL } } });
  });

  afterAll(async () => {
    await prisma.adminSession.deleteMany({ where: { admin: { email: { contains: TEST_EMAIL } } } });
    await prisma.admin.deleteMany({ where: { email: { contains: TEST_EMAIL } } });
    await prisma.onModuleDestroy();
  });

  it('creates a session, finds it while active, and excludes it once revoked', async () => {
    const admin = await adminRepository.create({
      email: TEST_EMAIL,
      passwordHash: 'argon2id$fake-hash-for-test',
      mfaSecretRef: 'v1.fake.reference.for-test',
      role: 'admin',
    });

    const session = await sessionRepository.create({
      adminId: admin.id,
      tokenHash: 'sha256-fake-token-hash-for-test',
      ipAddress: '203.0.113.10',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    expect(session.revokedAt).toBeNull();

    const found = await sessionRepository.findActiveByTokenHash(
      'sha256-fake-token-hash-for-test',
      new Date(),
    );
    expect(found?.id).toBe(session.id);

    await sessionRepository.revoke(session.id, new Date());
    const afterRevoke = await sessionRepository.findActiveByTokenHash(
      'sha256-fake-token-hash-for-test',
      new Date(),
    );
    expect(afterRevoke).toBeNull();
  });

  it('excludes a session whose absolute expiry has passed', async () => {
    const admin = await adminRepository.create({
      email: `expired-${TEST_EMAIL}`,
      passwordHash: 'argon2id$fake-hash-for-test',
      mfaSecretRef: 'v1.fake.reference.for-test',
      role: 'admin',
    });
    await sessionRepository.create({
      adminId: admin.id,
      tokenHash: 'sha256-fake-expired-token-hash',
      ipAddress: null,
      expiresAt: new Date(Date.now() - 1000),
    });

    const found = await sessionRepository.findActiveByTokenHash(
      'sha256-fake-expired-token-hash',
      new Date(),
    );
    expect(found).toBeNull();
  });

  it('touchLastActive updates lastActiveAt', async () => {
    const admin = await adminRepository.create({
      email: `touch-${TEST_EMAIL}`,
      passwordHash: 'argon2id$fake-hash-for-test',
      mfaSecretRef: 'v1.fake.reference.for-test',
      role: 'admin',
    });
    const session = await sessionRepository.create({
      adminId: admin.id,
      tokenHash: 'sha256-fake-touch-token-hash',
      ipAddress: null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const laterTime = new Date(session.lastActiveAt.getTime() + 60_000);
    await sessionRepository.touchLastActive(session.id, laterTime);
    const found = await sessionRepository.findActiveByTokenHash(
      'sha256-fake-touch-token-hash',
      new Date(),
    );
    expect(found?.lastActiveAt.getTime()).toBe(laterTime.getTime());
  });
});
