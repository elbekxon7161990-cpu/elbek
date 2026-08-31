import { Injectable } from '@nestjs/common';
import type { AuditLogRepository, NewAuditLogEntryData } from '@afa/domain';
import { AuditLogEntry } from '@afa/domain';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-AUTH-005 — the generic, reusable `audit_log` writer (see the domain
 * port's own doc comment for why this is for STANDALONE writes only, never
 * the elevation flow's own transactionally-coupled write).
 */
@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewAuditLogEntryData): Promise<AuditLogEntry> {
    const row = await this.prisma.auditLog.create({
      data: {
        actorType: data.actorType,
        actorId: data.actorId,
        action: data.action,
        targetUserId: data.targetUserId,
        targetResource: data.targetResource,
        justification: data.justification,
        ipAddress: data.ipAddress,
        metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    return new AuditLogEntry(
      row.id,
      row.actorType as AuditLogEntry['actorType'],
      row.actorId,
      row.action,
      row.targetUserId,
      row.targetResource,
      row.justification,
      row.ipAddress,
      row.metadata as Record<string, unknown> | null,
      row.createdAt,
    );
  }
}
