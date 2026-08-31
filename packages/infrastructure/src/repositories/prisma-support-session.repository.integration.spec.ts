import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaSupportSessionRepository } from './prisma-support-session.repository';

/**
 * Requires real Postgres — same precedent as sibling integration specs.
 *
 * `audit_log` rows this suite's successful-create scenarios produce are
 * permanent (append-only, TASK-DB-005) — see
 * `prisma-audit-log.repository.integration.spec.ts`'s own note.
 * `admins`/`users`/`support_sessions` rows ARE cleaned up. Any admin who
 * successfully opens a session (an `audit_log.actor_id` reference) becomes
 * permanently un-deletable — same consequence already documented for
 * TASK-AUTH-005's approver accounts — so cleanup filters those out before
 * deleting, same pattern as `prisma-admin-elevation.repository.integration.spec.ts`.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const TEST_EMAIL_DOMAIN = 'sec006-session-integration.example.invalid';

describe('PrismaSupportSessionRepository (integration)', () => {
  const prisma = new PrismaService();
  const repository = new PrismaSupportSessionRepository(prisma);
  const createdAdminIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.supportSession.deleteMany({ where: { targetUserId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

    const permanentlyReferenced = await prisma.auditLog.findMany({
      where: { actorId: { in: createdAdminIds } },
      select: { actorId: true },
    });
    const undeletableIds = new Set(permanentlyReferenced.map((row) => row.actorId));
    const deletableIds = createdAdminIds.filter((id) => !undeletableIds.has(id));
    if (deletableIds.length > 0) {
      await prisma.admin.deleteMany({ where: { id: { in: deletableIds } } });
    }

    await prisma.onModuleDestroy();
  });

  async function makeAdmin(label: string): Promise<string> {
    const admin = await prisma.admin.create({
      data: {
        email: `${label}-${randomBytes(4).toString('hex')}@${TEST_EMAIL_DOMAIN}`,
        passwordHash: 'not-a-real-hash-integration-test-fixture',
        role: 'admin',
      },
    });
    createdAdminIds.push(admin.id);
    return admin.id;
  }

  async function makeUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { telegramUserId: BigInt(Date.now()) + BigInt(Math.floor(Math.random() * 100000)) },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  it('create(): succeeds end to end — session persisted, exactly one audit_log entry with the right shape', async () => {
    const agentAdminId = await makeAdmin('create-success');
    const targetUserId = await makeUser();

    const session = await repository.create({
      agentAdminId,
      targetUserId,
      justification: 'user reported a discrepancy',
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(session.id).toBeDefined();
    expect(session.justification).toBe('user reported a discrepancy');

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'support_session.opened', targetResource: `support_session:${session.id}` },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.actorId).toBe(agentAdminId);
    expect(auditRows[0]?.targetUserId).toBe(targetUserId);
    expect(auditRows[0]?.justification).toBe('user reported a discrepancy');
  }, 20_000);

  it('create(): AUDIT-WRITE FAILURE ROLLS BACK THE SESSION TOO — a real FK violation on the target_user_id leaves NO session row (real Postgres, not a mock)', async () => {
    const agentAdminId = await makeAdmin('create-rollback');
    const nonexistentUserId = randomUUID();

    await expect(
      repository.create({
        agentAdminId,
        targetUserId: nonexistentUserId,
        justification: 'should never persist',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow();

    const sessions = await prisma.supportSession.findMany({ where: { agentAdminId } });
    expect(sessions).toHaveLength(0);
    const auditRows = await prisma.auditLog.findMany({
      where: { actorId: agentAdminId, action: 'support_session.opened' },
    });
    expect(auditRows).toHaveLength(0);
  }, 20_000);

  it('findActiveById excludes a closed session', async () => {
    const agentAdminId = await makeAdmin('exclude-closed');
    const targetUserId = await makeUser();
    const session = await repository.create({
      agentAdminId,
      targetUserId,
      justification: 'x',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await repository.close(session.id, new Date());
    const found = await repository.findActiveById(session.id, new Date());
    expect(found).toBeNull();
  }, 20_000);

  it('findActiveById excludes an expired session', async () => {
    const agentAdminId = await makeAdmin('exclude-expired');
    const targetUserId = await makeUser();
    const session = await repository.create({
      agentAdminId,
      targetUserId,
      justification: 'x',
      expiresAt: new Date(Date.now() - 1_000),
    });

    const found = await repository.findActiveById(session.id, new Date());
    expect(found).toBeNull();
  }, 20_000);

  it('close() is idempotent-safe — a second close attempt returns false, never a second write', async () => {
    const agentAdminId = await makeAdmin('close-idempotent');
    const targetUserId = await makeUser();
    const session = await repository.create({
      agentAdminId,
      targetUserId,
      justification: 'x',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const first = await repository.close(session.id, new Date());
    const second = await repository.close(session.id, new Date());
    expect(first).toBe(true);
    expect(second).toBe(false);
  }, 20_000);

  it('expireDueSessions() marks a past-expiry, still-open session as expired, and never touches a closed one', async () => {
    const agentAdminId = await makeAdmin('expire-sweep');
    const targetUserId = await makeUser();
    const dueSession = await repository.create({
      agentAdminId,
      targetUserId,
      justification: 'x',
      expiresAt: new Date(Date.now() - 1_000),
    });
    const alreadyClosedAgent = await makeAdmin('expire-sweep-closed');
    const alreadyClosedUser = await makeUser();
    const closedSession = await repository.create({
      agentAdminId: alreadyClosedAgent,
      targetUserId: alreadyClosedUser,
      justification: 'x',
      expiresAt: new Date(Date.now() - 1_000),
    });
    await repository.close(closedSession.id, new Date());

    const count = await repository.expireDueSessions(new Date());
    expect(count).toBeGreaterThanOrEqual(1);

    const dueRow = await prisma.supportSession.findUniqueOrThrow({ where: { id: dueSession.id } });
    expect(dueRow.expiredAt).not.toBeNull();

    const closedRow = await prisma.supportSession.findUniqueOrThrow({
      where: { id: closedSession.id },
    });
    expect(closedRow.expiredAt).toBeNull();
    expect(closedRow.closedAt).not.toBeNull();
  }, 20_000);
});
