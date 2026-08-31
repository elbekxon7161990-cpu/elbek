import { isNonEmptyString, isValidCurrencyCode, isValidDecimalAmount } from './decimal-amount';
import { InvalidBudgetError } from '../errors/invalid-budget.error';

/**
 * TASK-FIN-003 (Chapter 8 §8.4 Budget System, §13.7 `budgets`).
 * FR-BUD-001 — a budget is scoped to either a single category or the
 * special "Overall" scope (all categories combined) — never both, never
 * neither (`chk_budgets_scope_category`, `migration.sql`).
 */
export type BudgetScopeType = 'category' | 'overall';

/** §13.7's `period_type` CHECK — the four supported recurrence cadences (FR-BUD-001), monthly the PRD-stated default/most common. */
export type BudgetPeriodType = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/** §13.7's `status` CHECK. Only `'active'` is produced/consumed by any TASK-FIN-003 requirement (FR-BUD-001–008 cite no "pause" flow) — `'paused'` is accepted here only because the database itself allows it (defense-in-depth: the domain's validation must never reject a value the DB itself permits), not because this task builds a pause use case. */
export type BudgetStatus = 'active' | 'paused';

const SCOPE_TYPES: readonly BudgetScopeType[] = ['category', 'overall'];
const PERIOD_TYPES: readonly BudgetPeriodType[] = ['weekly', 'monthly', 'quarterly', 'yearly'];
const STATUSES: readonly BudgetStatus[] = ['active', 'paused'];

export interface BudgetProps {
  id: string;
  userId: string;
  scopeType: BudgetScopeType;
  /** Non-null exactly when `scopeType === 'category'` (`chk_budgets_scope_category`). */
  categoryId: string | null;
  /** CHECK limit_amount > 0 (§13.7, FR-BUD-001's own "positive decimal" validation rule, §8.4.6). */
  limitAmount: string;
  currency: string;
  periodType: BudgetPeriodType;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  status: BudgetStatus;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Shape needed to validate a not-yet-persisted budget — `id`/timestamps/`status`/`deletedAt` are persistence-assigned; `currentPeriodStart`/`currentPeriodEnd` are supplied by the caller (computed via `computeBudgetPeriodBoundaries`, not invented here) since a brand-new budget's first period is not necessarily "today" (e.g. §8.4.9's edge case — a budget created mid-period still uses that period's real boundaries, not a fresh one starting at creation time). */
export type NewBudgetValidationProps = Omit<
  BudgetProps,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'status'
>;

/**
 * §8.4's core aggregate. Enforces FR-BUD-001/§8.4.6's validation rules and
 * the scope/category consistency `chk_budgets_scope_category` also enforces
 * at the database layer — the same defense-in-depth relationship `Debt`'s
 * domain validation has with its own table's CHECK constraints.
 *
 * Deliberately holds no `usedAmount`/utilization figure of its own — FR-BUD-004
 * requires utilization to be "recalculated on every relevant query/event, not
 * a stale cached percentage" (restated by FR-FIN-032 for the whole formula
 * suite), so this entity is the budget's own *configuration*, not a snapshot
 * of its current state; utilization is always computed live by
 * `computeBudgetUtilization` (§8.14.4) against the real `Committed`-state
 * transaction data, never stored on this class.
 */
export class Budget {
  readonly id: string;
  readonly userId: string;
  readonly scopeType: BudgetScopeType;
  readonly categoryId: string | null;
  readonly limitAmount: string;
  readonly currency: string;
  readonly periodType: BudgetPeriodType;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly status: BudgetStatus;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: BudgetProps) {
    Budget.validate(props);
    this.id = props.id;
    this.userId = props.userId;
    this.scopeType = props.scopeType;
    this.categoryId = props.categoryId;
    this.limitAmount = props.limitAmount;
    this.currency = props.currency;
    this.periodType = props.periodType;
    this.currentPeriodStart = props.currentPeriodStart;
    this.currentPeriodEnd = props.currentPeriodEnd;
    this.status = props.status;
    this.deletedAt = props.deletedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  private static validate(props: BudgetProps): void {
    if (!isNonEmptyString(props.id)) {
      throw new InvalidBudgetError('Budget id is required.');
    }
    if (!isNonEmptyString(props.userId)) {
      throw new InvalidBudgetError('Budget userId is required.');
    }
    if (!SCOPE_TYPES.includes(props.scopeType)) {
      throw new InvalidBudgetError(`Invalid budget scopeType: "${String(props.scopeType)}".`);
    }
    // chk_budgets_scope_category, restated here (defense-in-depth).
    if (props.scopeType === 'overall' && props.categoryId !== null) {
      throw new InvalidBudgetError('An "overall" scope budget must not reference a category.');
    }
    if (props.scopeType === 'category' && !isNonEmptyString(props.categoryId ?? '')) {
      throw new InvalidBudgetError('A "category" scope budget must reference a category.');
    }
    if (!isValidDecimalAmount(props.limitAmount)) {
      throw new InvalidBudgetError(
        `limitAmount must be a positive decimal value, got "${props.limitAmount}".`,
      );
    }
    if (!isValidCurrencyCode(props.currency)) {
      throw new InvalidBudgetError(
        `currency must be a 3-letter ISO 4217 code, got "${props.currency}".`,
      );
    }
    if (!PERIOD_TYPES.includes(props.periodType)) {
      throw new InvalidBudgetError(`Invalid budget periodType: "${String(props.periodType)}".`);
    }
    if (
      !(props.currentPeriodStart instanceof Date) ||
      Number.isNaN(props.currentPeriodStart.getTime())
    ) {
      throw new InvalidBudgetError('currentPeriodStart must be a valid Date.');
    }
    if (
      !(props.currentPeriodEnd instanceof Date) ||
      Number.isNaN(props.currentPeriodEnd.getTime())
    ) {
      throw new InvalidBudgetError('currentPeriodEnd must be a valid Date.');
    }
    if (props.currentPeriodEnd.getTime() < props.currentPeriodStart.getTime()) {
      throw new InvalidBudgetError('currentPeriodEnd cannot be before currentPeriodStart.');
    }
    if (!STATUSES.includes(props.status)) {
      throw new InvalidBudgetError(`Invalid budget status: "${String(props.status)}".`);
    }
  }

  /** Validates a not-yet-persisted budget (`CreateBudgetUseCase`) without requiring persistence-assigned fields. */
  static validateNew(props: NewBudgetValidationProps, now: Date = new Date()): void {
    Budget.validate({
      ...props,
      id: 'pending',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  get isDeleted(): boolean {
    return this.deletedAt !== null;
  }
}
