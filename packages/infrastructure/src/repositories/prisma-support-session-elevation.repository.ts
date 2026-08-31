import { Injectable } from '@nestjs/common';
import type {
  GrantSupportSessionElevationParams,
  NewSupportSessionElevationRequestData,
  SupportSessionElevationRepository,
} from '@afa/domain';
import { SupportSessionElevationRequest } from '@afa/domain';

import { PrismaService } from '../prisma/prisma.service';

function toEntity(row: {
  id: string;
  supportSessionId: string;
  createdAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
  resolvedByAdminId: string | null;
  closedAt: Date | null;
}): SupportSessionElevationRequest {
  return new SupportSessionElevationRequest(
    row.id,
    row.supportSessionId,
    row.createdAt,
    row.expiresAt,
    row.resolvedAt,
    row.resolvedByAdminId,
    row.closedAt,
  );
}

/**
 * TASK-SEC-006 — `grant()` mirrors `PrismaAdminElevationRepository.grant()`
 * (TASK-AUTH-005) exactly in shape: one `$transaction` atomically consumes
 * the pending request AND inserts the `audit_log` entry — a failed audit
 * write rolls back the consume too. Sets `resolvedAt`/`resolvedByAdminId`
 * on the ELEVATION REQUEST row (a temporary, session-scoped grant), never
 * `Admin.role` (AUTH-005's own, permanent, different target).
 */
@Injectable()
export class PrismaSupportSessionElevationRepository implements SupportSessionElevationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createRequest(
    data: NewSupportSessionElevationRequestData,
  ): Promise<SupportSessionElevationRequest> {
    const row = await this.prisma.supportSessionElevationRequest.create({
      data: { supportSessionId: data.supportSessionId, expiresAt: data.expiresAt },
    });
    return toEntity(row);
  }

  async findPendingById(id: string, now: Date): Promise<SupportSessionElevationRequest | null> {
    const row = await this.prisma.supportSessionElevationRequest.findFirst({
      where: { id, resolvedAt: null, closedAt: null, expiresAt: { gt: now } },
    });
    return row ? toEntity(row) : null;
  }

  async grant(params: GrantSupportSessionElevationParams): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const consumed = await tx.supportSessionElevationRequest.updateMany({
        where: {
          id: params.requestId,
          resolvedAt: null,
          closedAt: null,
          expiresAt: { gt: params.now },
        },
        data: { resolvedAt: params.now, resolvedByAdminId: params.approverAdminId },
      });
      if (consumed.count === 0) {
        return false;
      }

      await tx.auditLog.create({
        data: {
          actorType: 'admin',
          actorId: params.approverAdminId,
          action: 'support_session.elevated',
          targetUserId: params.targetUserId,
          targetResource: `support_session:${params.supportSessionId}`,
          justification: null,
          ipAddress: null,
          metadata: {
            supportSessionId: params.supportSessionId,
            elevationRequestId: params.requestId,
          },
        },
      });

      return true;
    });
  }

  async findCurrentlyElevated(
    supportSessionId: string,
    now: Date,
  ): Promise<SupportSessionElevationRequest | null> {
    const row = await this.prisma.supportSessionElevationRequest.findFirst({
      where: {
        supportSessionId,
        resolvedAt: { not: null },
        closedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { resolvedAt: 'desc' },
    });
    return row ? toEntity(row) : null;
  }

  async close(id: string, now: Date): Promise<boolean> {
    const result = await this.prisma.supportSessionElevationRequest.updateMany({
      where: { id, resolvedAt: { not: null }, closedAt: null },
      data: { closedAt: now },
    });
    return result.count > 0;
  }
}
