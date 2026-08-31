import { Inject, Injectable } from '@nestjs/common';
import type {
  Budget,
  BudgetEditableFields,
  BudgetRepository,
  CategoryRepository,
} from '@afa/domain';
import { BUDGET_REPOSITORY, CATEGORY_REPOSITORY } from '@afa/domain';

import { BudgetNotFoundError } from '../errors/budget-not-found.error';
import { CategoryNotFoundError } from '../errors/category-not-found.error';
import { UnauthorizedBudgetAccessError } from '../errors/unauthorized-budget-access.error';

export interface EditBudgetInput {
  userId: string;
  budgetId: string;
  changes: BudgetEditableFields;
}

/** FR-BUD-007 — "editing (limit amount, category) ... at any time." */
@Injectable()
export class EditBudgetUseCase {
  constructor(
    @Inject(BUDGET_REPOSITORY) private readonly budgetRepository: BudgetRepository,
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepository: CategoryRepository,
  ) {}

  async execute(input: EditBudgetInput): Promise<Budget> {
    const existing = await this.budgetRepository.findById(input.budgetId);
    if (!existing || existing.isDeleted) {
      throw new BudgetNotFoundError(input.budgetId);
    }
    // Never trust a client-supplied budgetId alone, even under RLS
    // (this task's own explicit architecture requirement) — a fast-path
    // pre-check purely for a clear error message; `update()`'s own atomic
    // conditional `WHERE id = ? AND user_id = ?` is the real guard below.
    if (existing.userId !== input.userId) {
      throw new UnauthorizedBudgetAccessError(input.budgetId, input.userId);
    }

    if (input.changes.categoryId !== undefined) {
      const category = await this.categoryRepository.findById(input.changes.categoryId);
      if (!category || category.status !== 'active') {
        throw new CategoryNotFoundError(input.changes.categoryId);
      }
    }

    const updated = await this.budgetRepository.update(input.budgetId, input.userId, input.changes);
    if (updated === null) {
      throw new BudgetNotFoundError(input.budgetId);
    }
    return updated;
  }
}
