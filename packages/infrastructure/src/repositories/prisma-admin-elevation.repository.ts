import { Injectable } from '@nestjs/common';
import type {
  AdminElevationRepository,
  GrantAdminElevationParams,
  NewAdminElevationRequestData,
} from '@afa/domain';
import { AdminElevationRequest } from '@afa/domain';

import { PrismaService } from '../prisma/prisma.service';

function toEntity(row: {
  id: string;
  targetAdminId: string;
  createdAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
  resolvedByAdminId: string | null;
}): AdminElevationRequest {
  return new AdminElevationRequest(
    row.id,
    row.targetAdminId,
    row.createdAt,
    row.expiresAt,
    row.resolvedAt,
    row.resolvedByAdminId,
  );
}

/**
 * TASK-AUTH-005 — Chapter 16 §16.10's `admin` -> `super_admin` elevation
 * grant. `grant()` is the DoD's own "audit-log write transactionally
 * coupled to the elevation itself" made real: one `$transaction` performs
 * the conditional request-consume, the `Admin.role` update, and the
 * `audit_log` INSERT together — if the audit-log INSERT throws, Postgres
 * rolls back all three, so a failed audit write both fails the elevation
 * AND leaves the request unconsumed (safe to legitimately retry), never a
 * silent partial success.
 */
@Injectable()
export class PrismaAdminElevationRepository implements AdminElevationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createRequest(data: NewAdminElevationRequestData): Promise<AdminElevationRequest> {
    const row = await this.prisma.adminElevationRequest.create({
      data: {
        targetAdminId: data.targetAdminId,
        expiresAt: data.expiresAt,
      },
    });
    return toEntity(row);
  }

  async findPendingById(id: string, now: Date): Promise<AdminElevationRequest | null> {
    const row = await this.prisma.adminElevationRequest.findFirst({
      where: { id, resolvedAt: null, expiresAt: { gt: now } },
    });
    return row ? toEntity(row) : null;
  }

  async grant(params: GrantAdminElevationParams): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // The true concurrency-safety boundary: only one concurrent caller's
      // conditional UPDATE can ever match this row (Postgres serializes
      // concurrent UPDATEs to the same row; the loser's WHERE re-evaluates
      // against the winner's already-committed `resolvedAt`, matching
      // nothing). Also re-checks staleness (`expiresAt`) at grant time, not
      // just at the earlier `findPendingById` read.
      const consumed = await tx.adminElevationRequest.updateMany({
        where: { id: params.requestId, resolvedAt: null, expiresAt: { gt: params.now } },
        data: { resolvedAt: params.now, resolvedByAdminId: params.approverAdminId },
      });
      if (consumed.count === 0) {
        return false;
      }

      await tx.admin.update({
        where: { id: params.targetAdminId },
        data: { role: 'super_admin' },
      });

      // Throwing here (e.g. a genuine DB error) rolls back BOTH writes above
      // — the DoD's own explicit requirement, never a silent partial grant.
      await tx.auditLog.create({
        data: {
          actorType: 'admin',
          actorId: params.approverAdminId,
          action: 'admin.elevated_to_super_admin',
          targetUserId: null,
          targetResource: `admin:${params.targetAdminId}`,
          justification: null,
          ipAddress: params.ipAddress,
          metadata: { elevationRequestId: params.requestId, targetAdminId: params.targetAdminId },
        },
      });

      return true;
    });
  }
}
