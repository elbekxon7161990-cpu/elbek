import { Injectable } from '@nestjs/common';
import type { DebtReminderCandidate, DebtReminderRepository, DomainEventType } from '@afa/domain';
import { toLocalCalendarDate } from '@afa/domain';
import { runWithUserContext } from '@afa/shared';

import { formatDecimalAmount } from './format-decimal-amount';
import { PrismaService } from '../prisma/prisma.service';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Debt Reminder Producer task — implements @afa/domain's
 * `DebtReminderRepository` port against `debts`/`domain_events`.
 *
 * `Debt` is RLS-protected (`rls-protected-models.ts`) — unlike
 * `domain_events` (deliberately NOT RLS-protected, a system-wide dispatch
 * queue), there is no way to run one unscoped, system-wide query across
 * every user's debts: Postgres's own row-level-security policy would
 * either be silently bypassed (a real security regression, if this
 * connects as a role RLS doesn't apply to) or would correctly return zero
 * rows for every user at once (a correctness bug, if it connects as the
 * RLS-enforced `app_user` role, as production does) — there is no safe
 * "read across all tenants" query against this table. `findCandidates`
 * therefore iterates real users (via `this.prisma.user`, NOT RLS-protected)
 * and, for each, runs one correctly-scoped, `runWithUserContext`-wrapped
 * query using the EXISTING `idx_debts_user_status_due` index — an N+1
 * query pattern by user count, deliberately, since this is a background
 * batch job (not latency-sensitive) and there is no safe alternative that
 * doesn't either bypass or break RLS.
 */
@Injectable()
export class PrismaDebtReminderRepository implements DebtReminderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findCandidates(now: Date): Promise<DebtReminderCandidate[]> {
    const users = await this.prisma.user.findMany({
      where: { status: 'active' },
      select: { id: true, timezone: true },
    });

    const candidates: DebtReminderCandidate[] = [];
    for (const user of users) {
      const localToday = toLocalCalendarDate(now, user.timezone);
      // "Approaching" includes tomorrow (FR-DBT-007's "1 day before") — the
      // upper bound is local-tomorrow, inclusive. No lower bound at all:
      // an overdue debt of any age remains a candidate until resolved
      // (FR-DBT-007's own "until resolved" — no arbitrary cutoff).
      const upperBoundInclusive = new Date(localToday.getTime() + ONE_DAY_MS);

      const rows = await runWithUserContext(user.id, () =>
        this.prisma.debt.findMany({
          where: {
            userId: user.id,
            status: 'open',
            deletedAt: null,
            dueDate: { not: null, lte: upperBoundInclusive },
          },
        }),
      );

      for (const row of rows) {
        candidates.push({
          debtId: row.id,
          userId: user.id,
          counterpartyName: row.counterpartyName,
          outstandingBalance: formatDecimalAmount(row.outstandingBalance),
          currency: row.currency,
          dueDate: row.dueDate!,
          userTimezone: user.timezone,
        });
      }
    }
    return candidates;
  }

  async wasReminderEventRecentlyRecorded(
    debtId: string,
    eventType: DomainEventType,
    sinceDate: Date,
  ): Promise<boolean> {
    const match = await this.prisma.domainEvent.findFirst({
      where: {
        eventType,
        payload: { path: ['debtId'], equals: debtId },
        createdAt: { gte: sinceDate },
      },
      select: { id: true },
    });
    return match !== null;
  }
}
