import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaAuditLogRepository } from './prisma-audit-log.repository';

/**
 * Requires real Postgres — same precedent as `prisma-api-token.repository.integration.spec.ts`.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

/**
 * NOTE ON CLEANUP: `audit_log` is genuinely append-only — the app connection
 * (`app_user`) has UPDATE/DELETE revoked at the DB-role level (TASK-DB-005),
 * so there is no cleanup step here at all: rows this suite creates are
 * permanent, by design, the same as the one pre-existing precedent in this
 * codebase (`prisma-account-purge.repository.integration.spec.ts`'s own
 * account-purge audit row). `action` values below are prefixed
 * `integration-test.` specifically so they stay greppable/identifiable in
 * the live table, per this repo's own "clearly-fake, greppable" convention
 * for live-staging-DB test data.
 */
describe('PrismaAuditLogRepository (integration)', () => {
  const prisma = new PrismaService();
  const repository = new PrismaAuditLogRepository(prisma);

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('creates a standalone audit_log entry with every field persisted', async () => {
    const entry = await repository.create({
      actorType: 'system',
      actorId: null,
      action: 'integration-test.standalone-write',
      targetUserId: null,
      targetResource: 'integration-test-resource',
      justification: 'integration test coverage',
      ipAddress: null,
      metadata: { source: 'prisma-audit-log.repository.integration.spec.ts' },
    });

    expect(entry.actorType).toBe('system');
    expect(entry.actorId).toBeNull();
    expect(entry.action).toBe('integration-test.standalone-write');
    expect(entry.targetResource).toBe('integration-test-resource');
    expect(entry.justification).toBe('integration test coverage');
    expect(entry.metadata).toEqual({ source: 'prisma-audit-log.repository.integration.spec.ts' });
    expect(entry.createdAt).toBeInstanceOf(Date);
  }, 20_000);

  it('is genuinely immutable at the DB-role level — UPDATE/DELETE from the app connection is rejected (TASK-DB-005 own DoD, re-verified here)', async () => {
    const entry = await repository.create({
      actorType: 'system',
      actorId: null,
      action: 'integration-test.immutability-check',
      targetUserId: null,
      targetResource: null,
      justification: null,
      ipAddress: null,
      metadata: null,
    });

    await expect(
      prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow();
  }, 20_000);
});
