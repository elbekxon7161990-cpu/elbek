import type { DomainEventType } from '../events/domain-event';

export const DEBT_REMINDER_REPOSITORY = Symbol('DEBT_REMINDER_REPOSITORY');

/** Grounded directly in `Debt`'s own real, already-built fields (`@afa/domain`'s `debt.entity.ts`) — not invented from PRD prose alone, and matches exactly the payload shape TASK-BOT-009's own `NotificationDeliveryConsumer`/`parseDebtReminderPayload` already expect. */
export interface DebtReminderCandidate {
  debtId: string;
  userId: string;
  counterpartyName: string;
  outstandingBalance: string;
  currency: string;
  /** Calendar-date-only (§13.6 `due_date DATE`). */
  dueDate: Date;
  userTimezone: string;
}

/**
 * Debt Reminder Producer task — a dedicated, read-only port, deliberately
 * separate from `DebtRepository` (TASK-FIN-002) and `DomainEventRepository`
 * (TASK-DB-010/FR-DB-015) — neither of those ports is modified by this
 * task; this is a new, narrow capability purpose-built for the scheduled
 * eligibility scan, following the same dedicated-repository-per-purpose
 * precedent already established repeatedly in this codebase
 * (`ExpenseHistoryRepository`, `ReportQueryRepository`).
 */
export interface DebtReminderRepository {
  /**
   * Every open debt, across every user, with a non-null `due_date` on or
   * before "tomorrow" in that debt's OWN owning user's local timezone —
   * i.e. every debt that is either already overdue (any age — FR-DBT-007's
   * "until resolved" has no cutoff) or within the approaching window (due
   * today or tomorrow). No further classification happens here — this is
   * intentionally a superset; `classifyDebtReminderCondition`
   * (`@afa/domain`) performs the precise, per-candidate decision in
   * application code, since `debts` is RLS-protected and the timezone-
   * exact boundary genuinely differs per user.
   */
  findCandidates(now: Date): Promise<DebtReminderCandidate[]>;

  /**
   * Producer-side dedup: was an event of `eventType` already recorded for
   * this debt at or after `sinceDate`? Reads `domain_events` directly
   * (NOT RLS-protected — a system-wide dispatch queue, same reasoning
   * `PrismaDomainEventRepository`'s own doc comment already gives). This
   * is the producer's own "don't emit an obvious duplicate" guard — the
   * final, authoritative safety net remains FR-FIN-048's own "idempotent
   * consumption" contract, already satisfied by TASK-BOT-009's existing
   * consumer-side dedup gate.
   */
  wasReminderEventRecentlyRecorded(
    debtId: string,
    eventType: DomainEventType,
    sinceDate: Date,
  ): Promise<boolean>;
}
