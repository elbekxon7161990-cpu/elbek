import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaSupportSessionElevationRepository } from './prisma-support-session-elevation.repository';
import { PrismaSupportSessionRepository } from './prisma-support-session.repository';

/**
 * Requires real Postgres. Cleanup follows the same audit_log-permanence
 * pattern as sibling integration specs (see those files' own notes).
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const TEST_EMAIL_DOMAIN = 'sec006-elevation-integration.example.invalid';

describe('PrismaSupportSessionElevationRepository (integration)', () => {
  const prisma = new PrismaService();
  const sessions = new PrismaSupportSessionRepository(prisma);
  const repository = new PrismaSupportSessionElevationRepository(prisma);
  const createdAdminIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.supportSessionElevationRequest.deleteMany({
      where: { supportSession: { targetUserId: { in: createdUserIds } } },
    });
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

  async function makeAdmin(
    label: string,
    role: 'admin' | 'super_admin' = 'admin',
  ): Promise<string> {
    const admin = await prisma.admin.create({
      data: {
        email: `${label}-${randomBytes(4).toString('hex')}@${TEST_EMAIL_DOMAIN}`,
        passwordHash: 'not-a-real-hash-integration-test-fixture',
        role,
      },
    });
    createdAdminIds.push(admin.id);
    return admin.id;
  }

  async function makeSession(agentAdminId: string): Promise<{ id: string; targetUserId: string }> {
    const user = await prisma.user.create({
      data: { telegramUserId: BigInt(Date.now()) + BigInt(Math.floor(Math.random() * 100000)) },
    });
    createdUserIds.push(user.id);
    const session = await sessions.create({
      agentAdminId,
      targetUserId: user.id,
      justification: 'integration test fixture',
      expiresAt: new Date(Date.now() + 60_000),
    });
    return { id: session.id, targetUserId: user.id };
  }

  it('grant(): succeeds end to end — request resolved, exactly one audit_log entry, findCurrentlyElevated returns it', async () => {
    const agentAdminId = await makeAdmin('grant-success-agent');
    const approverAdminId = await makeAdmin('grant-success-approver', 'super_admin');
    const session = await makeSession(agentAdminId);
    const request = await repository.createRequest({
      supportSessionId: session.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const granted = await repository.grant({
      requestId: request.id,
      supportSessionId: session.id,
      targetUserId: session.targetUserId,
      approverAdminId,
      now: new Date(),
    });
    expect(granted).toBe(true);

    const current = await repository.findCurrentlyElevated(session.id, new Date());
    expect(current?.id).toBe(request.id);

    const auditRows = await prisma.auditLog.findMany({
      where: {
        action: 'support_session.elevated',
        targetResource: `support_session:${session.id}`,
      },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.actorId).toBe(approverAdminId);
    expect(auditRows[0]?.targetUserId).toBe(session.targetUserId);
  }, 20_000);

  it('grant(): AUDIT-WRITE FAILURE ROLLS BACK THE CONSUME — a real FK violation (nonexistent approverAdminId) leaves the request pending, no audit row', async () => {
    const agentAdminId = await makeAdmin('grant-rollback-agent');
    const session = await makeSession(agentAdminId);
    const request = await repository.createRequest({
      supportSessionId: session.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const nonexistentApproverId = randomUUID();

    await expect(
      repository.grant({
        requestId: request.id,
        supportSessionId: session.id,
        targetUserId: session.targetUserId,
        approverAdminId: nonexistentApproverId,
        now: new Date(),
      }),
    ).rejects.toThrow();

    const stillPending = await repository.findPendingById(request.id, new Date());
    expect(stillPending).not.toBeNull();

    const auditRows = await prisma.auditLog.findMany({
      where: {
        targetResource: `support_session:${session.id}`,
        action: 'support_session.elevated',
      },
    });
    expect(auditRows).toHaveLength(0);
  }, 20_000);

  it('CONCURRENT GRANT RACE — two simultaneous grant() calls for the SAME request: exactly one wins, exactly one audit_log entry exists', async () => {
    const agentAdminId = await makeAdmin('grant-race-agent');
    const approverAdminId = await makeAdmin('grant-race-approver', 'super_admin');
    const session = await makeSession(agentAdminId);
    const request = await repository.createRequest({
      supportSessionId: session.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const now = new Date();
    const [resultA, resultB] = await Promise.all([
      repository.grant({
        requestId: request.id,
        supportSessionId: session.id,
        targetUserId: session.targetUserId,
        approverAdminId,
        now,
      }),
      repository.grant({
        requestId: request.id,
        supportSessionId: session.id,
        targetUserId: session.targetUserId,
        approverAdminId,
        now,
      }),
    ]);
    const winners = [resultA, resultB].filter(Boolean);
    expect(winners).toHaveLength(1);

    const auditRows = await prisma.auditLog.findMany({
      where: {
        action: 'support_session.elevated',
        targetResource: `support_session:${session.id}`,
      },
    });
    expect(auditRows).toHaveLength(1);
  }, 20_000);

  it('close() de-elevates — findCurrentlyElevated returns null afterward, and a second close returns false', async () => {
    const agentAdminId = await makeAdmin('close-agent');
    const approverAdminId = await makeAdmin('close-approver', 'super_admin');
    const session = await makeSession(agentAdminId);
    const request = await repository.createRequest({
      supportSessionId: session.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await repository.grant({
      requestId: request.id,
      supportSessionId: session.id,
      targetUserId: session.targetUserId,
      approverAdminId,
      now: new Date(),
    });

    const firstClose = await repository.close(request.id, new Date());
    expect(firstClose).toBe(true);
    const current = await repository.findCurrentlyElevated(session.id, new Date());
    expect(current).toBeNull();

    const secondClose = await repository.close(request.id, new Date());
    expect(secondClose).toBe(false);
  }, 20_000);
});
