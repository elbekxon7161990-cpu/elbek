import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaAdminElevationRepository } from './prisma-admin-elevation.repository';

/**
 * Requires real Postgres — same precedent as `prisma-api-token.repository.integration.spec.ts`.
 *
 * `audit_log` rows this suite's successful-grant scenarios produce are
 * permanent (append-only, TASK-DB-005) — see
 * `prisma-audit-log.repository.integration.spec.ts`'s own note. A direct,
 * real consequence of that immutability: any admin who successfully acted
 * as an APPROVER is permanently referenced by `audit_log.actor_id`
 * (`ON DELETE RESTRICT`), so that admin row can never be deleted either —
 * `admin_elevation_requests` rows are always cleaned up, but `admins` rows
 * are only deleted for the subset NOT referenced by any `audit_log` entry
 * (computed in `afterAll` below), never assumed deletable up front.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const TEST_EMAIL_DOMAIN = 'auth005-elevation-integration.example.invalid';

describe('PrismaAdminElevationRepository (integration)', () => {
  const prisma = new PrismaService();
  const repository = new PrismaAdminElevationRepository(prisma);
  const createdAdminIds: string[] = [];

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.adminElevationRequest.deleteMany({
      where: { targetAdminId: { in: createdAdminIds } },
    });

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

  async function makeAdmin(role: 'admin' | 'super_admin', label: string): Promise<string> {
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

  it('createRequest + findPendingById: a freshly-created request is found pending', async () => {
    const targetAdminId = await makeAdmin('admin', 'pending-lookup');
    const request = await repository.createRequest({
      targetAdminId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const found = await repository.findPendingById(request.id, new Date());
    expect(found?.id).toBe(request.id);
    expect(found?.resolvedAt).toBeNull();
  }, 20_000);

  it('findPendingById excludes an expired request', async () => {
    const targetAdminId = await makeAdmin('admin', 'expired-lookup');
    const request = await repository.createRequest({
      targetAdminId,
      expiresAt: new Date(Date.now() - 1_000),
    });

    const found = await repository.findPendingById(request.id, new Date());
    expect(found).toBeNull();
  }, 20_000);

  it('findPendingById excludes an already-resolved request', async () => {
    const targetAdminId = await makeAdmin('admin', 'resolved-lookup');
    const approverAdminId = await makeAdmin('super_admin', 'resolved-lookup-approver');
    const request = await repository.createRequest({
      targetAdminId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const granted = await repository.grant({
      requestId: request.id,
      targetAdminId,
      approverAdminId,
      ipAddress: null,
      now: new Date(),
    });
    expect(granted).toBe(true);

    const found = await repository.findPendingById(request.id, new Date());
    expect(found).toBeNull();
  }, 20_000);

  it('grant(): succeeds end to end — role updated, request resolved, exactly one audit_log entry with the right shape', async () => {
    const targetAdminId = await makeAdmin('admin', 'grant-success-target');
    const approverAdminId = await makeAdmin('super_admin', 'grant-success-approver');
    const request = await repository.createRequest({
      targetAdminId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const granted = await repository.grant({
      requestId: request.id,
      targetAdminId,
      approverAdminId,
      ipAddress: '203.0.113.7',
      now: new Date(),
    });
    expect(granted).toBe(true);

    const updatedAdmin = await prisma.admin.findUniqueOrThrow({ where: { id: targetAdminId } });
    expect(updatedAdmin.role).toBe('super_admin');

    const resolvedRequest = await prisma.adminElevationRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(resolvedRequest.resolvedAt).not.toBeNull();
    expect(resolvedRequest.resolvedByAdminId).toBe(approverAdminId);

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'admin.elevated_to_super_admin', targetResource: `admin:${targetAdminId}` },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.actorId).toBe(approverAdminId);
    expect(auditRows[0]?.actorType).toBe('admin');
    expect(auditRows[0]?.ipAddress).toBe('203.0.113.7');
    expect(
      (auditRows[0]?.metadata as { elevationRequestId?: string } | null)?.elevationRequestId,
    ).toBe(request.id);
  }, 20_000);

  it('grant(): a stale (expired) request is rejected — returns false, no side effects', async () => {
    const targetAdminId = await makeAdmin('admin', 'grant-stale-target');
    const approverAdminId = await makeAdmin('super_admin', 'grant-stale-approver');
    const request = await repository.createRequest({
      targetAdminId,
      expiresAt: new Date(Date.now() - 1_000),
    });

    const granted = await repository.grant({
      requestId: request.id,
      targetAdminId,
      approverAdminId,
      ipAddress: null,
      now: new Date(),
    });
    expect(granted).toBe(false);

    const untouchedAdmin = await prisma.admin.findUniqueOrThrow({ where: { id: targetAdminId } });
    expect(untouchedAdmin.role).toBe('admin');
  }, 20_000);

  it("grant(): AUDIT-WRITE FAILURE ROLLS BACK EVERYTHING — a real FK-constraint violation on the audit_log INSERT (nonexistent approverAdminId) leaves the role AND the request completely unchanged (the DoD's own deliberate-audit-failure requirement, exercised against real Postgres, not a mock)", async () => {
    const targetAdminId = await makeAdmin('admin', 'grant-rollback-target');
    const request = await repository.createRequest({
      targetAdminId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const nonexistentApproverId = randomUUID();

    await expect(
      repository.grant({
        requestId: request.id,
        targetAdminId,
        approverAdminId: nonexistentApproverId,
        ipAddress: null,
        now: new Date(),
      }),
    ).rejects.toThrow();

    const untouchedAdmin = await prisma.admin.findUniqueOrThrow({ where: { id: targetAdminId } });
    expect(untouchedAdmin.role).toBe('admin');

    const stillPending = await prisma.adminElevationRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(stillPending.resolvedAt).toBeNull();
    expect(stillPending.resolvedByAdminId).toBeNull();

    const auditRows = await prisma.auditLog.findMany({
      where: { targetResource: `admin:${targetAdminId}` },
    });
    expect(auditRows).toHaveLength(0);
  }, 20_000);

  it('grant(): CONCURRENT GRANT RACE — two simultaneous grant() calls for the SAME request: exactly one wins, role is set exactly once, exactly one audit_log entry exists', async () => {
    const targetAdminId = await makeAdmin('admin', 'grant-race-target');
    const approverAdminId = await makeAdmin('super_admin', 'grant-race-approver');
    const request = await repository.createRequest({
      targetAdminId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const now = new Date();
    const [resultA, resultB] = await Promise.all([
      repository.grant({
        requestId: request.id,
        targetAdminId,
        approverAdminId,
        ipAddress: null,
        now,
      }),
      repository.grant({
        requestId: request.id,
        targetAdminId,
        approverAdminId,
        ipAddress: null,
        now,
      }),
    ]);
    const winners = [resultA, resultB].filter(Boolean);
    expect(winners).toHaveLength(1);

    const finalAdmin = await prisma.admin.findUniqueOrThrow({ where: { id: targetAdminId } });
    expect(finalAdmin.role).toBe('super_admin');

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'admin.elevated_to_super_admin', targetResource: `admin:${targetAdminId}` },
    });
    expect(auditRows).toHaveLength(1);

    // A third, later call also loses — the request is already resolved (replay).
    const thirdAttempt = await repository.grant({
      requestId: request.id,
      targetAdminId,
      approverAdminId,
      ipAddress: null,
      now: new Date(),
    });
    expect(thirdAttempt).toBe(false);
  }, 20_000);
});
