import { isNonEmptyString, isValidCurrencyCode, isValidDecimalAmount } from './decimal-amount';
import { compareCalendarDateOnly } from './calendar-date';
import { InvalidSavingsGoalError } from '../errors/invalid-savings-goal.error';

/**
 * TASK-FIN-004 (Chapter 8 §8.9 Savings Goals, §13.21 `savings_goals`).
 * FR-FIN-012's dual contribution mechanism (a standalone `GOAL_CONTRIBUTION`
 * transaction, or a `TRANSFER` linked via `Transaction.goalId`) is enforced
 * on the `Transaction` entity, not here — see `transaction.entity.ts`'s own
 * TASK-FIN-004 validation. Per TASK-FIN-004 Stage A's approved architecture
 * decision (Open Question B), a standalone `GOAL_CONTRIBUTION` never affects
 * any `Account` balance (BR-FIN-003 — "has not left the user's net worth,
 * only been earmarked"); a linked `TRANSFER` does, via the transfer's own
 * balance handling (TASK-FIN-004 Stage G, `compute-account-balance.ts`),
 * not through this entity.
 */
export type SavingsGoalStatus = 'active' | 'completed';

const SAVINGS_GOAL_STATUSES: readonly SavingsGoalStatus[] = ['active', 'completed'];

export interface SavingsGoalProps {
  id: string;
  userId: string;
  name: string;
  /** CHECK target_amount > 0 (§13.21.2). Never changes after creation — the PRD defines no "edit target" flow. */
  targetAmount: string;
  currency: string;
  targetDate: Date | null;
  status: SavingsGoalStatus;
  /**
   * §13.21.2 — the highest milestone threshold (e.g. 25/50/75/100) already
   * notified for, `null` if none yet. The persisted dedup marker
   * `detectNewlyCrossedGoalMilestones` (this package's own
   * `savings-goals/` helper) consumes to determine which thresholds are
   * newly crossed — TASK-FIN-004 Stage F wires the actual progress
   * computation (an application/infrastructure concern; this entity has no
   * visibility into `Transaction`/contribution rows).
   */
  lastMilestoneFired: number | null;
  deletedAt: Date | null;
  /** §13.21.2 genuinely has no `updated_at` column — confirmed against the schema, not an omission. */
  createdAt: Date;
}

/** Shape needed to validate a not-yet-persisted savings goal — `status`/`lastMilestoneFired` are excluded on purpose, mirroring `Debt`/`Loan`'s "a brand-new aggregate always starts at its own fixed initial state" precedent. */
export type NewSavingsGoalValidationProps = Omit<
  SavingsGoalProps,
  'id' | 'createdAt' | 'deletedAt' | 'status' | 'lastMilestoneFired'
>;

/**
 * §8.9's core aggregate. Deliberately holds no contribution total of its
 * own — progress is always computed live from linked `Transaction` rows
 * (TASK-FIN-004 Stage F, §8.14.5), the same "derived, never a stale cached
 * figure" relationship `Account`'s balance already has with its own
 * transactions.
 */
export class SavingsGoal {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly targetAmount: string;
  readonly currency: string;
  readonly targetDate: Date | null;
  readonly status: SavingsGoalStatus;
  readonly lastMilestoneFired: number | null;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;

  constructor(props: SavingsGoalProps) {
    SavingsGoal.validate(props);
    this.id = props.id;
    this.userId = props.userId;
    this.name = props.name;
    this.targetAmount = props.targetAmount;
    this.currency = props.currency;
    this.targetDate = props.targetDate;
    this.status = props.status;
    this.lastMilestoneFired = props.lastMilestoneFired;
    this.deletedAt = props.deletedAt;
    this.createdAt = props.createdAt;
  }

  private static validate(props: SavingsGoalProps): void {
    if (!isNonEmptyString(props.id)) {
      throw new InvalidSavingsGoalError('SavingsGoal id is required.');
    }
    if (!isNonEmptyString(props.userId)) {
      throw new InvalidSavingsGoalError('SavingsGoal userId is required.');
    }
    if (!isNonEmptyString(props.name)) {
      throw new InvalidSavingsGoalError('SavingsGoal name is required.');
    }
    if (!isValidDecimalAmount(props.targetAmount)) {
      throw new InvalidSavingsGoalError(
        `targetAmount must be a positive decimal value, got "${props.targetAmount}".`,
      );
    }
    if (!isValidCurrencyCode(props.currency)) {
      throw new InvalidSavingsGoalError(
        `currency must be a 3-letter ISO 4217 code, got "${props.currency}".`,
      );
    }
    if (
      props.targetDate !== null &&
      (!(props.targetDate instanceof Date) || Number.isNaN(props.targetDate.getTime()))
    ) {
      throw new InvalidSavingsGoalError(
        'SavingsGoal targetDate, when provided, must be a valid Date.',
      );
    }
    if (!SAVINGS_GOAL_STATUSES.includes(props.status)) {
      throw new InvalidSavingsGoalError(`Invalid savings goal status: "${String(props.status)}".`);
    }
    // §13.21.2 has no CHECK bounding this column's range; a loose
    // 0-100(exclusive-of-0) sanity bound is enforced here defensively
    // without hardcoding the exact [25,50,75,100] default set, since
    // FR-FIN-013 explicitly reserves per-user threshold configurability for
    // a later (P2) iteration — the same restraint
    // `evaluateBudgetThresholdCrossing`'s own doc comment already applies to
    // Budget's analogous defaults.
    if (
      props.lastMilestoneFired !== null &&
      (!Number.isInteger(props.lastMilestoneFired) ||
        props.lastMilestoneFired <= 0 ||
        props.lastMilestoneFired > 100)
    ) {
      throw new InvalidSavingsGoalError(
        `lastMilestoneFired, when provided, must be an integer in (0, 100], got "${String(props.lastMilestoneFired)}".`,
      );
    }
  }

  /**
   * Validates a not-yet-persisted savings goal (TASK-FIN-004 Stage C's
   * Create Savings Goal use case), plus the one CREATION-time-only rule
   * (§8.9.4 — "a `target_date` in the past is rejected with clarification,
   * mirroring BR-DBT's due-date sanity check pattern") that the standing
   * invariants above deliberately don't duplicate, mirroring `Debt`'s own
   * `dueDate`/`validateNew` precedent exactly.
   */
  static validateNew(props: NewSavingsGoalValidationProps, now: Date = new Date()): void {
    SavingsGoal.validate({
      ...props,
      id: 'pending',
      status: 'active',
      lastMilestoneFired: null,
      createdAt: now,
      deletedAt: null,
    });
    if (props.targetDate !== null && compareCalendarDateOnly(props.targetDate, now) === -1) {
      throw new InvalidSavingsGoalError('targetDate cannot be in the past.');
    }
  }

  get isDeleted(): boolean {
    return this.deletedAt !== null;
  }

  get isCompleted(): boolean {
    return this.status === 'completed';
  }

  /**
   * TASK-FIN-008 (§8.14.5) — a non-concurrent domain helper, semantically
   * ALIGNED with but not itself the authoritative production completion
   * decision: `evaluate-savings-goal-progress-on-contribution-commit.ts`'s
   * own concurrency-hardened SQL-mutation hook (which never calls this
   * method, deliberately — re-encoding the identical FR-FIN-014 rule
   * inline instead, since it decides completion from `highestNewMilestone
   * >= 100` under a held row lock, not from a separately-passed
   * `newProgressPercent` a caller could race against) is authoritative for
   * production behavior. Verified equivalent, not merely assumed: a
   * milestone-crossing detector never reports `100` among the newly-crossed
   * thresholds unless the true recomputed progress has itself reached
   * `>= 100` (§8.14.5's own `DEFAULT_GOAL_MILESTONE_THRESHOLDS` caps at
   * 100 — no higher threshold exists to report instead), so
   * `highestNewMilestone >= 100` and this method's own
   * `newProgressPercent >= 100` are the same boolean condition reached by
   * two different, equally-valid proxies for "progress just reached the
   * target." This method remains the correct, directly-testable
   * implementation for any future non-concurrent caller (e.g. a read-only
   * status recomputation) and for domain-level unit tests that verify the
   * transition rule in isolation from SQL/locking concerns.
   *
   * FR-FIN-014 — "on reaching `target_amount`, a `SAVINGS_GOAL` transitions
   * to `status = 'completed'`... though further contributions remain
   * possible." Pure state transition: `newProgressPercent` is computed
   * elsewhere (TASK-FIN-004 Stage F, from the live contribution sum — this
   * entity has no visibility into `Transaction` rows), this method only
   * applies the already-unambiguous FR-FIN-014 rule to it. Idempotent —
   * calling this again once already `'completed'` (e.g. a later contribution
   * that keeps progress at/above 100%) simply returns the same status,
   * never errors, matching FR-FIN-014's explicit "further contributions
   * remain possible" allowance. Progress can only monotonically increase in
   * this codebase (no withdrawal/reversal mechanism exists — confirmed
   * absent from the PRD, not modeled), so a 'completed' goal never needs to
   * revert to 'active' here. Takes no `now` parameter — unlike every other
   * state-transition method in this codebase (`Transaction.delete/restore`,
   * `Debt.applyRepayment/forgive`), `SavingsGoal` has no `updatedAt` column
   * to stamp (§13.21.2 — confirmed, not an omission), so there is nothing
   * for a timestamp argument to do here.
   */
  evaluateCompletion(newProgressPercent: number): SavingsGoal {
    const shouldComplete = this.status === 'active' && newProgressPercent >= 100;
    if (!shouldComplete) {
      return this;
    }
    return new SavingsGoal({
      id: this.id,
      userId: this.userId,
      name: this.name,
      targetAmount: this.targetAmount,
      currency: this.currency,
      targetDate: this.targetDate,
      status: 'completed',
      lastMilestoneFired: this.lastMilestoneFired,
      deletedAt: this.deletedAt,
      createdAt: this.createdAt,
    });
  }
}
