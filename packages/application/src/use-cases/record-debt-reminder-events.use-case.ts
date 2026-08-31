import { Inject, Injectable } from '@nestjs/common';
import {
  classifyDebtReminderCondition,
  DEBT_REMINDER_REPOSITORY,
  DOMAIN_EVENT_REPOSITORY,
  toLocalCalendarDate,
  type DebtReminderCandidate,
  type DebtReminderRepository,
  type DomainEventRepository,
  type DomainEventType,
} from '@afa/domain';

/**
 * FR-DBT-007 — "approaching (1 day before, and on the due date itself)":
 * once a debt enters the approaching window it can be classified
 * "approaching" on at most 2 distinct calendar days per debt — a window
 * well under a day is sufficient to prevent the SAME calendar day's check
 * from double-firing (this producer's own scan interval is daily, a
 * disclosed judgment call — see `DebtReminderProducerScheduler`'s own doc
 * comment), without needing precise local-midnight boundary arithmetic.
 */
const APPROACHING_DEDUP_WINDOW_MS = 20 * 60 * 60 * 1000; // 20 hours

/** FR-DBT-007 — "overdue debts (recurring reminder, default weekly, until resolved or dismissed)." A PRD-stated default, not invented. "...or dismissed" has no implementation — no dismiss mechanism exists anywhere in this codebase (see this task's final report); only "until resolved" (the debt leaving `status='open'`, which removes it from `findCandidates` entirely) is implemented. */
const OVERDUE_DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface RecordDebtReminderEventsSummary {
  candidatesScanned: number;
  approachingEmitted: number;
  overdueEmitted: number;
  skippedAsDuplicate: number;
}

/**
 * Debt Reminder Producer task — "Scheduled Worker -> Query eligible debts
 * -> Determine due/overdue condition -> Atomically/idempotently record
 * DomainEvent" (the architecture target given for this task), implemented
 * as the policy layer on top of `DebtReminderRepository`'s own mechanics —
 * the same "policy above, mechanics below" split `DispatchDomainEventsUseCase`
 * already established for FR-DB-015.
 *
 * Uses the EXISTING, UNMODIFIED `DomainEventRepository.record()` — this
 * task adds no new method to that port, and does not touch FR-DB-015's own
 * `dispatchNextPending`. `record()` is a standalone, non-transactionally-
 * coupled write (its own doc comment) — acceptable here because, unlike
 * `TransactionCommitted`, there is no second write this event must be
 * atomically coupled with; the eligibility condition itself (a debt still
 * being open and due) is read-only, derived state, not a state transition
 * this call itself performs.
 *
 * Idempotency: a producer-side dedup check (`wasReminderEventRecentlyRecorded`)
 * guards the common case; the authoritative safety net remains FR-FIN-048's
 * own "safe to consume more than once" contract, already satisfied by
 * TASK-BOT-009's existing consumer-side dedup gate — so a rare concurrent-
 * run race that slips past this check is still safe, never a duplicate
 * user-visible notification.
 */
@Injectable()
export class RecordDebtReminderEventsUseCase {
  constructor(
    @Inject(DEBT_REMINDER_REPOSITORY) private readonly reminderRepository: DebtReminderRepository,
    @Inject(DOMAIN_EVENT_REPOSITORY) private readonly domainEventRepository: DomainEventRepository,
  ) {}

  async execute(now: Date = new Date()): Promise<RecordDebtReminderEventsSummary> {
    const candidates = await this.reminderRepository.findCandidates(now);

    let approachingEmitted = 0;
    let overdueEmitted = 0;
    let skippedAsDuplicate = 0;

    for (const candidate of candidates) {
      const referenceLocalDate = toLocalCalendarDate(now, candidate.userTimezone);
      const condition = classifyDebtReminderCondition(candidate.dueDate, referenceLocalDate);
      if (condition === 'none') {
        continue;
      }

      const eventType: DomainEventType =
        condition === 'approaching' ? 'DebtDueApproaching' : 'DebtOverdue';
      const dedupWindowMs =
        condition === 'approaching' ? APPROACHING_DEDUP_WINDOW_MS : OVERDUE_DEDUP_WINDOW_MS;
      const sinceDate = new Date(now.getTime() - dedupWindowMs);

      const alreadyRecorded = await this.reminderRepository.wasReminderEventRecentlyRecorded(
        candidate.debtId,
        eventType,
        sinceDate,
      );
      if (alreadyRecorded) {
        skippedAsDuplicate += 1;
        continue;
      }

      await this.domainEventRepository.record({
        eventType,
        payload: buildPayload(candidate, candidate.dueDate),
      });

      if (condition === 'approaching') {
        approachingEmitted += 1;
      } else {
        overdueEmitted += 1;
      }
    }

    return {
      candidatesScanned: candidates.length,
      approachingEmitted,
      overdueEmitted,
      skippedAsDuplicate,
    };
  }
}

function buildPayload(candidate: DebtReminderCandidate, dueDate: Date): Record<string, unknown> {
  return {
    debtId: candidate.debtId,
    userId: candidate.userId,
    counterpartyName: candidate.counterpartyName,
    outstandingBalance: candidate.outstandingBalance,
    currency: candidate.currency,
    dueDate: dueDate.toISOString(),
  };
}
