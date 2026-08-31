import { Injectable } from '@nestjs/common';
import type { NewSupportSessionData, SupportSessionRepository } from '@afa/domain';
import { SupportSession } from '@afa/domain';

import { PrismaService } from '../prisma/prisma.service';

function toEntity(row: {
  id: string;
  agentAdminId: string;
  targetUserId: string;
  justification: string;
  createdAt: Date;
  expiresAt: Date;
  closedAt: Date | null;
  expiredAt: Date | null;
}): SupportSession {
  return new SupportSession(
    row.id,
    row.agentAdminId,
    row.targetUserId,
    row.justification,
    row.createdAt,
    row.expiresAt,
    row.closedAt,
    row.expiredAt,
  );
}

/**
 * TASK-SEC-006 — `create()` is NFR-ADM-002's "audit log write must be
 * synchronous with the admin action" made real: one `$transaction` inserts
 * the `support_sessions` row AND the `audit_log` entry together — if the
 * audit INSERT throws, the session row rolls back too, so an un-audited
 * `Active` session is structurally impossible, never merely
 * policy-discouraged. Same pattern as `PrismaAdminElevationRepository.grant()`
 * (TASK-AUTH-005).
 */
@Injectable()
export class PrismaSupportSessionRepository implements SupportSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewSupportSessionData): Promise<SupportSession> {
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supportSession.create({
        data: {
          agentAdminId: data.agentAdminId,
          targetUserId: data.targetUserId,
          justification: data.justification,
          expiresAt: data.expiresAt,
        },
      });

      await tx.auditLog.create({
        data: {
          actorType: 'admin',
          actorId: data.agentAdminId,
          action: 'support_session.opened',
          targetUserId: data.targetUserId,
          targetResource: `support_session:${created.id}`,
          justification: data.justification,
          ipAddress: null,
          metadata: { supportSessionId: created.id },
        },
      });

      return created;
    });

    return toEntity(row);
  }

  async findActiveById(id: string, now: Date): Promise<SupportSession | null> {
    const row = await this.prisma.supportSession.findFirst({
      where: { id, closedAt: null, expiredAt: null, expiresAt: { gt: now } },
    });
    return row ? toEntity(row) : null;
  }

  async close(id: string, now: Date): Promise<boolean> {
    const result = await this.prisma.supportSession.updateMany({
      where: { id, closedAt: null, expiredAt: null },
      data: { closedAt: now },
    });
    return result.count > 0;
  }

  async expireDueSessions(now: Date): Promise<number> {
    const result = await this.prisma.supportSession.updateMany({
      where: { expiresAt: { lt: now }, closedAt: null, expiredAt: null },
      data: { expiredAt: now },
    });
    return result.count;
  }
}
