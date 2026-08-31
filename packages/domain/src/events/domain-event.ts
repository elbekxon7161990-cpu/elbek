/**
 * TASK-DB-010 (Chapter 8 §8.22.2's "Domain Events" table) — the authoritative
 * event-type catalogue, reproduced here verbatim as real TypeScript rather
 * than PRD prose, per `FR-FIN-049` ("the event catalogue... is the
 * authoritative list — a new cross-cutting trigger... must be added here, not
 * defined independently by the consuming chapter"). All twelve names below
 * are listed for completeness (FR-FIN-049's own authority requirement), but
 * this task implements a real *producer* for exactly one of them
 * (`TransactionCommitted` — see `prisma-transaction.repository.ts`); the
 * other eleven have no producer/payload type built yet and must not be
 * assumed wired up just because the name exists here — see this task's final
 * report for the precise implemented-vs-catalogued split, and TASK-BOT-009's
 * own scope analysis for why building the remaining producers is explicitly
 * out of this task's scope (they belong to Chapter 8/9's own not-yet-built
 * Budget/Debt/Loan/Goal modules).
 *
 * TASK-FIN-003 adds a real producer for `BudgetThresholdCrossed` (see
 * `PrismaTransactionRepository.create()`'s Budget-threshold hook and
 * `PrismaBudgetRepository`), mirroring the Debt Reminder Producer task's own
 * later addition of real producers for `DebtDueApproaching`/`DebtOverdue`/
 * `DebtSettled` — updating this comment rather than leaving it to silently
 * drift, per `ENGINEERING-STANDARDS.md` §6.1's ownership-drift warning
 * (FR-FIN-049's own citation above).
 *
 * TASK-FIN-004 (FR-FIN-013/014) adds real producers for
 * `GoalMilestoneReached`/`GoalCompleted` (see
 * `evaluate-savings-goal-progress-on-contribution-commit.ts`), the same
 * "synchronous, same-transaction, conditional-on-a-real-state-crossing"
 * shape as `BudgetThresholdCrossed`. `LoanInstallmentDue` remains
 * unproduced — Loan reminders are TASK-BOT-009's own scope (Chapter 10
 * `FR-NOT-*`), not this task's.
 */
export const DOMAIN_EVENT_TYPES = [
  'TransactionCommitted',
  'TransactionEdited',
  'TransactionDeleted',
  'TransactionRestored',
  'BudgetThresholdCrossed',
  'DebtDueApproaching',
  'DebtOverdue',
  'DebtSettled',
  'LoanInstallmentDue',
  'GoalMilestoneReached',
  'GoalCompleted',
  'DuplicateSuspected',
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

/** §13.30.2's `domain_events.status` CHECK values. The Prisma column itself is plain `TEXT` (no DB-level CHECK constraint exists in the current schema — see this task's final report) — this literal union is the domain layer's own, stricter contract on top of that looser column, the same "domain owns the tighter type than the DB enforces" pattern already used for `DraftStatus`. */
export type DomainEventStatus = 'pending' | 'dispatched' | 'failed';

/**
 * `TransactionCommitted`'s payload shape. §8.22.2's own worked example says
 * `{transaction_id, user_id}` only — `transactionDate` is an additive
 * extension, added by TASK-DB-009 (FR-DB-025), since cache invalidation
 * cannot determine which `report:{user_id}:{report_type}:{period_key}` keys
 * are affected without knowing the transaction's date. This is the exact
 * "identify the gap, extend the smallest way, consistent with TASK-DB-010"
 * case: no new event type, no new table, one additional field on an
 * already-produced payload.
 */
export interface TransactionCommittedPayload {
  transactionId: string;
  userId: string;
  /** ISO 8601 date (`transaction_date`, §13.4) — ISO string, not a `Date`, since this crosses the JSONB boundary. */
  transactionDate: string;
}

/**
 * `TransactionEdited`'s payload shape (TASK-DB-009, FR-DB-025). Carries BOTH
 * the pre-edit and post-edit `transactionDate` — required because a
 * backdated edit can move a transaction from one cached period into another,
 * and once the update has committed, the pre-edit date is otherwise gone
 * (the row only reflects its new state). Fired on every edit, not only a
 * date change — any field edit (amount, category, etc.) makes its
 * containing period's cached aggregate stale too; when the date itself did
 * not change, `previousTransactionDate` and `newTransactionDate` are equal.
 */
export interface TransactionEditedPayload {
  transactionId: string;
  userId: string;
  previousTransactionDate: string;
  newTransactionDate: string;
}

/** `TransactionDeleted`'s payload shape (TASK-DB-009, FR-DB-025) — the (soft-)deleted transaction's own date, the only one still needed once it's gone from standard report queries. */
export interface TransactionDeletedPayload {
  transactionId: string;
  userId: string;
  transactionDate: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * TASK-DB-009 — a consumer must "fail safely" on a malformed/unsupported
 * payload (this task's own explicit requirement), meaning throw a clear
 * error rather than silently doing nothing and still reporting success.
 * Throwing lets FR-DB-015's own existing retry/terminal-failure machinery
 * handle it — no new error-handling policy invented here.
 */
export function parseTransactionCommittedPayload(
  payload: Record<string, unknown>,
): TransactionCommittedPayload {
  const { transactionId, userId, transactionDate } = payload;
  if (
    !isNonEmptyString(transactionId) ||
    !isNonEmptyString(userId) ||
    !isNonEmptyString(transactionDate)
  ) {
    throw new Error(
      'Malformed TransactionCommitted payload: expected { transactionId, userId, transactionDate } as non-empty strings.',
    );
  }
  return { transactionId, userId, transactionDate };
}

export function parseTransactionEditedPayload(
  payload: Record<string, unknown>,
): TransactionEditedPayload {
  const { transactionId, userId, previousTransactionDate, newTransactionDate } = payload;
  if (
    !isNonEmptyString(transactionId) ||
    !isNonEmptyString(userId) ||
    !isNonEmptyString(previousTransactionDate) ||
    !isNonEmptyString(newTransactionDate)
  ) {
    throw new Error(
      'Malformed TransactionEdited payload: expected { transactionId, userId, previousTransactionDate, newTransactionDate } as non-empty strings.',
    );
  }
  return { transactionId, userId, previousTransactionDate, newTransactionDate };
}

export function parseTransactionDeletedPayload(
  payload: Record<string, unknown>,
): TransactionDeletedPayload {
  const { transactionId, userId, transactionDate } = payload;
  if (
    !isNonEmptyString(transactionId) ||
    !isNonEmptyString(userId) ||
    !isNonEmptyString(transactionDate)
  ) {
    throw new Error(
      'Malformed TransactionDeleted payload: expected { transactionId, userId, transactionDate } as non-empty strings.',
    );
  }
  return { transactionId, userId, transactionDate };
}

/**
 * TASK-BOT-009 (Chapter 8 §8.22.2 — "Consumed By: Chapter 10") — no real
 * producer exists yet for `DebtDueApproaching`/`DebtOverdue`/`DebtSettled`
 * (Chapter 8's own scheduled reminder-detection job and the reminder-aware
 * parts of `DebtRepository` are explicitly out of this task's scope; see
 * this task's final report). This payload shape is this task's own,
 * grounded directly in `Debt`'s real, already-built domain fields
 * (`@afa/domain`'s `debt.entity.ts`) rather than invented from PRD prose
 * alone, so a future producer has a concrete, already-consumed contract to
 * emit against rather than needing to design one from scratch.
 */
export interface DebtReminderPayload {
  debtId: string;
  userId: string;
  counterpartyName: string;
  outstandingBalance: string;
  currency: string;
  /** ISO 8601 date. */
  dueDate: string;
}

export interface DebtSettledPayload {
  debtId: string;
  userId: string;
  counterpartyName: string;
  /** `Debt.status` at settlement — only `'repaid'`/`'forgiven'` are valid (the two terminal, settled states; `'open'` would never legitimately produce this event). */
  status: 'repaid' | 'forgiven';
}

export function parseDebtReminderPayload(payload: Record<string, unknown>): DebtReminderPayload {
  const { debtId, userId, counterpartyName, outstandingBalance, currency, dueDate } = payload;
  if (
    !isNonEmptyString(debtId) ||
    !isNonEmptyString(userId) ||
    !isNonEmptyString(counterpartyName) ||
    !isNonEmptyString(outstandingBalance) ||
    !isNonEmptyString(currency) ||
    !isNonEmptyString(dueDate)
  ) {
    throw new Error(
      'Malformed debt-reminder payload: expected { debtId, userId, counterpartyName, outstandingBalance, currency, dueDate } as non-empty strings.',
    );
  }
  return { debtId, userId, counterpartyName, outstandingBalance, currency, dueDate };
}

export function parseDebtSettledPayload(payload: Record<string, unknown>): DebtSettledPayload {
  const { debtId, userId, counterpartyName, status } = payload;
  if (
    !isNonEmptyString(debtId) ||
    !isNonEmptyString(userId) ||
    !isNonEmptyString(counterpartyName) ||
    (status !== 'repaid' && status !== 'forgiven')
  ) {
    throw new Error(
      'Malformed DebtSettled payload: expected { debtId, userId, counterpartyName, status: "repaid" | "forgiven" }.',
    );
  }
  return { debtId, userId, counterpartyName, status };
}

/**
 * TASK-FIN-003 (§8.22.2 — "Budget utilization crosses a configured
 * threshold (FR-BUD-005)"). Emitted synchronously, in the SAME database
 * transaction as the `EXPENSE` transaction commit that caused the crossing
 * (`PrismaTransactionRepository.create()`'s own established
 * `TransactionCommitted` coupling, applied here to a second, conditional
 * event type) — never a separate, non-atomic follow-up call, per FR-FIN-048.
 * `thresholdPercent` is one of `DEFAULT_BUDGET_THRESHOLDS` (75/90/100);
 * `periodStart` is an ISO calendar date, carried through so the consumer's
 * own dedup/render logic never needs a second `Budget` read to know which
 * period this crossing belongs to.
 */
export interface BudgetThresholdCrossedPayload {
  budgetId: string;
  userId: string;
  scopeType: 'category' | 'overall';
  categoryName: string | null;
  thresholdPercent: number;
  utilizationPercent: number;
  limitAmount: string;
  usedAmount: string;
  currency: string;
  /** ISO 8601 date — the budget's `currentPeriodStart` at the moment of crossing. */
  periodStart: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseBudgetThresholdCrossedPayload(
  payload: Record<string, unknown>,
): BudgetThresholdCrossedPayload {
  const {
    budgetId,
    userId,
    scopeType,
    categoryName,
    thresholdPercent,
    utilizationPercent,
    limitAmount,
    usedAmount,
    currency,
    periodStart,
  } = payload;
  if (
    !isNonEmptyString(budgetId) ||
    !isNonEmptyString(userId) ||
    (scopeType !== 'category' && scopeType !== 'overall') ||
    (categoryName !== null && !isNonEmptyString(categoryName)) ||
    !isFiniteNumber(thresholdPercent) ||
    !isFiniteNumber(utilizationPercent) ||
    !isNonEmptyString(limitAmount) ||
    !isNonEmptyString(usedAmount) ||
    !isNonEmptyString(currency) ||
    !isNonEmptyString(periodStart)
  ) {
    throw new Error(
      'Malformed BudgetThresholdCrossed payload: expected { budgetId, userId, scopeType: "category" | "overall", categoryName: string | null, thresholdPercent, utilizationPercent, limitAmount, usedAmount, currency, periodStart }.',
    );
  }
  return {
    budgetId,
    userId,
    scopeType,
    categoryName: categoryName as string | null,
    thresholdPercent,
    utilizationPercent,
    limitAmount,
    usedAmount,
    currency,
    periodStart,
  };
}

/**
 * TASK-FIN-004 (FR-FIN-013, §8.22.2 — "Goal progress crosses a threshold").
 * Emitted synchronously, in the SAME database transaction as the
 * `GOAL_CONTRIBUTION`/goal-linked-`TRANSFER` commit that caused the
 * crossing (`evaluate-savings-goal-progress-on-contribution-commit.ts`'s
 * own established atomic-update coupling), mirroring
 * `BudgetThresholdCrossedPayload`'s exact shape/reasoning for its own
 * sibling threshold event. `thresholdPercent` is one of
 * `DEFAULT_GOAL_MILESTONE_THRESHOLDS` (25/50/75) — the 100 case is a
 * distinct `GoalCompleted` event instead (§8.22.2 catalogues them
 * separately), never both for the same crossing.
 */
export interface GoalMilestoneReachedPayload {
  goalId: string;
  userId: string;
  name: string;
  thresholdPercent: number;
  progressPercent: number;
  targetAmount: string;
  currency: string;
}

/**
 * TASK-FIN-004 (FR-FIN-014, §8.22.2). Fired exactly once, the first time a
 * goal's progress reaches 100% (never again for later contributions past
 * target, per FR-FIN-014's own "further contributions remain possible"
 * allowance) — the producer's own atomic-update gate guarantees this by
 * construction, not a check performed here.
 */
export interface GoalCompletedPayload {
  goalId: string;
  userId: string;
  name: string;
  targetAmount: string;
  currency: string;
}

export function parseGoalMilestoneReachedPayload(
  payload: Record<string, unknown>,
): GoalMilestoneReachedPayload {
  const { goalId, userId, name, thresholdPercent, progressPercent, targetAmount, currency } =
    payload;
  if (
    !isNonEmptyString(goalId) ||
    !isNonEmptyString(userId) ||
    !isNonEmptyString(name) ||
    !isFiniteNumber(thresholdPercent) ||
    !isFiniteNumber(progressPercent) ||
    !isNonEmptyString(targetAmount) ||
    !isNonEmptyString(currency)
  ) {
    throw new Error(
      'Malformed GoalMilestoneReached payload: expected { goalId, userId, name, thresholdPercent, progressPercent, targetAmount, currency }.',
    );
  }
  return { goalId, userId, name, thresholdPercent, progressPercent, targetAmount, currency };
}

export function parseGoalCompletedPayload(payload: Record<string, unknown>): GoalCompletedPayload {
  const { goalId, userId, name, targetAmount, currency } = payload;
  if (
    !isNonEmptyString(goalId) ||
    !isNonEmptyString(userId) ||
    !isNonEmptyString(name) ||
    !isNonEmptyString(targetAmount) ||
    !isNonEmptyString(currency)
  ) {
    throw new Error(
      'Malformed GoalCompleted payload: expected { goalId, userId, name, targetAmount, currency }.',
    );
  }
  return { goalId, userId, name, targetAmount, currency };
}
