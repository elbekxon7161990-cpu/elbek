import { Inject, Injectable } from '@nestjs/common';
import type {
  CategoryRepository,
  CustomCategory,
  DetectedLanguage,
  TransactionRepository,
} from '@afa/domain';
import { CATEGORY_REPOSITORY, TRANSACTION_REPOSITORY } from '@afa/domain';

import { CustomCategoryNotFoundError } from '../errors/custom-category-not-found.error';

/**
 * TASK-FIN-006 (§7.4.7, §11.7.6-mirrored "migration preview") — shown to the
 * user BEFORE the deletion is finalized, per the worked example (§7.9.6):
 * "the user is shown exactly which transactions were affected before the
 * deletion is finalized."
 */
export interface DeleteCustomCategoryPreview {
  category: CustomCategory;
  parentLabel: string;
  affectedTransactionCount: number;
}

export interface DeleteCustomCategoryResult {
  category: CustomCategory;
  parentLabel: string;
  reassignedTransactionCount: number;
}

/** `null` — same idempotent-safe double-delete contract as the repository's own `deleteAndReassignTransactions`: the category was already deprecated (e.g. a concurrent/duplicate confirm tap), never a second reversal attempt. */
export type DeleteCustomCategoryOutcome = DeleteCustomCategoryResult | null;

@Injectable()
export class DeleteCustomCategoryUseCase {
  constructor(
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepository: CategoryRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactionRepository: TransactionRepository,
  ) {}

  async preview(
    categoryId: string,
    userId: string,
    language: DetectedLanguage,
  ): Promise<DeleteCustomCategoryPreview> {
    const category = await this.categoryRepository.findCustomCategoryById(categoryId, userId);
    if (!category) {
      throw new CustomCategoryNotFoundError(categoryId);
    }
    const [parentLabel, affectedTransactionCount] = await Promise.all([
      this.categoryRepository.findCategoryLabelById(category.parentCategoryId, language),
      this.transactionRepository.countActiveByCategoryId(userId, categoryId),
    ]);
    return {
      category,
      parentLabel: parentLabel ?? category.parentCategoryId,
      affectedTransactionCount,
    };
  }

  async execute(
    categoryId: string,
    userId: string,
    language: DetectedLanguage,
  ): Promise<DeleteCustomCategoryOutcome> {
    const result = await this.categoryRepository.deleteAndReassignTransactions(categoryId, userId);
    if (!result) {
      return null;
    }
    const parentLabel = await this.categoryRepository.findCategoryLabelById(
      result.parentCategoryId,
      language,
    );
    return {
      category: result.category,
      parentLabel: parentLabel ?? result.parentCategoryId,
      reassignedTransactionCount: result.reassignedTransactionCount,
    };
  }
}
