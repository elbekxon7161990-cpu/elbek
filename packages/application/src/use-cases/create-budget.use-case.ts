import { Inject, Injectable } from '@nestjs/common';
import type {
  Budget,
  BudgetPeriodType,
  BudgetRepository,
  BudgetScopeType,
  CategoryRepository,
  CurrencyRepository,
  UserRepository,
} from '@afa/domain';
import {
  Budget as BudgetEntity,
  BUDGET_REPOSITORY,
  CATEGORY_REPOSITORY,
  computeBudgetPeriodBoundaries,
  CURRENCY_REPOSITORY,
  DuplicateBudgetError,
  USER_REPOSITORY,
} from '@afa/domain';

import { CategoryNotFoundError } from '../errors/category-not-found.error';
import { InvalidCurrencyError } from '../errors/invalid-currency.error';
import { UserNotFoundError } from '../errors/user-not-found.error';
import { resolveUserLocalReferenceDate } from './resolve-user-local-reference-date';

/**
 * TASK-FIN-003 (Chapter 8 §8.4) — structured input only, mirroring
 * `CreateDebtUseCase`'s own precedent. Natural-language budget creation
 * ("set a 2 million budget for food this month", FR-BUD-002) is NOT wired
 * to this use case from free text — see this task's final report for the
 * discovered contradiction (Chapter 4 §4.3.1's closed intent taxonomy has
 * no `BUDGET_CREATE`-equivalent entry, and FR-AI-010 requires every input
 * classify into that taxonomy's own closed list). This use case is reached
 * via the guided `/budget` flow (`IN_BUDGET_SETUP`), whose own single-turn
 * answer parser performs light, deterministic field extraction (not a new
 * LLM intent) before calling this use case with already-structured fields.
 */
export interface CreateBudgetInput {
  userId: string;
  scopeType: BudgetScopeType;
  /** Required when `scopeType === 'category'`; must be omitted/`undefined` for `'overall'`. */
  categoryId?: string;
  limitAmount: string;
  currency: string;
  periodType: BudgetPeriodType;
}

export interface BudgetCreatedOutcome {
  kind: 'created';
  budget: Budget;
}

/** §8.4.7 — "offers to update the existing budget instead of creating a conflicting second one." Never a silent reject; the caller decides whether to route to `EditBudgetUseCase` against `existingBudgetId`. */
export interface BudgetDuplicateOutcome {
  kind: 'duplicate';
  existingBudgetId: string;
}

export type CreateBudgetOutcome = BudgetCreatedOutcome | BudgetDuplicateOutcome;

@Injectable()
export class CreateBudgetUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CURRENCY_REPOSITORY) private readonly currencyRepository: CurrencyRepository,
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepository: CategoryRepository,
    @Inject(BUDGET_REPOSITORY) private readonly budgetRepository: BudgetRepository,
  ) {}

  async execute(input: CreateBudgetInput): Promise<CreateBudgetOutcome> {
    const user = await this.userRepository.findById(input.userId);
    if (!user) {
      throw new UserNotFoundError(input.userId);
    }

    const currencySupported = await this.currencyRepository.isSupported(input.currency);
    if (!currencySupported) {
      throw new InvalidCurrencyError(input.currency);
    }

    if (input.scopeType === 'category') {
      if (!input.categoryId) {
        throw new CategoryNotFoundError('(none supplied)');
      }
      const category = await this.categoryRepository.findById(input.categoryId);
      // BR-EXP-001-equivalent for budgets — a category-scope budget must
      // reference an existing, non-deprecated category (§8.4.6's own
      // validation table), the same rule `CreateExpenseUseCase` already
      // enforces for transactions via `validateTransactionReferences`.
      if (!category || category.status !== 'active') {
        throw new CategoryNotFoundError(input.categoryId);
      }
    }

    // FR-BUD-003 — a brand-new budget's first period is the REAL calendar
    // period containing "now" in the user's own timezone (§8.4.9's edge
    // case: a budget created mid-period still shows correct
    // already-elapsed-days-in-period math), never a period starting fresh
    // at creation time.
    const now = new Date();
    const referenceLocalDate = resolveUserLocalReferenceDate(now, user.timezone);
    const { currentPeriodStart, currentPeriodEnd } = computeBudgetPeriodBoundaries(
      referenceLocalDate,
      input.periodType,
    );

    const categoryId = input.scopeType === 'category' ? input.categoryId! : null;

    BudgetEntity.validateNew(
      {
        userId: input.userId,
        scopeType: input.scopeType,
        categoryId,
        limitAmount: input.limitAmount,
        currency: input.currency,
        periodType: input.periodType,
        currentPeriodStart,
        currentPeriodEnd,
      },
      now,
    );

    try {
      const budget = await this.budgetRepository.create({
        userId: input.userId,
        scopeType: input.scopeType,
        categoryId,
        limitAmount: input.limitAmount,
        currency: input.currency,
        periodType: input.periodType,
        currentPeriodStart,
        currentPeriodEnd,
      });
      return { kind: 'created', budget };
    } catch (error) {
      if (error instanceof DuplicateBudgetError) {
        return { kind: 'duplicate', existingBudgetId: error.existingBudgetId };
      }
      throw error;
    }
  }
}
