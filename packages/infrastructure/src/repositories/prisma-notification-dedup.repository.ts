import { Injectable } from '@nestjs/common';
import type { NotificationDedupRepository } from '@afa/domain';

import { PrismaService } from '../prisma/prisma.service';

interface NotificationDedupPayloadShape {
  dedupKey?: string;
}

const MAX_RECENT_ROWS_SCANNED = 20;

/**
 * TASK-BOT-009 (FR-NOT-009) — implements @afa/domain's
 * `NotificationDedupRepository` port by querying existing `notifications`
 * rows directly (no dedicated dedup table — see the port's own doc
 * comment). Filters `dedupKey` in application code rather than a raw JSONB
 * query, since the candidate row count per `(userId, type)` within any
 * reasonable dedup window is small (a handful of reminders, never
 * hundreds) — `MAX_RECENT_ROWS_SCANNED` bounds the read regardless.
 */
@Injectable()
export class PrismaNotificationDedupRepository implements NotificationDedupRepository {
  constructor(private readonly prisma: PrismaService) {}

  async wasRecentlyNotified(
    userId: string,
    type: string,
    dedupKey: string,
    asOf: Date,
    withinMs: number,
  ): Promise<boolean> {
    const since = new Date(asOf.getTime() - withinMs);
    const rows = await this.prisma.notification.findMany({
      where: { userId, type, createdAt: { gte: since } },
      select: { payload: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_RECENT_ROWS_SCANNED,
    });
    return rows.some(
      (row) => (row.payload as unknown as NotificationDedupPayloadShape)?.dedupKey === dedupKey,
    );
  }
}
