import type { CategoryRepository, CurrencyRepository } from '@afa/domain';

import { InvalidCategoryError } from '../errors/invalid-category.error';
import { InvalidCurrencyError } from '../errors/invalid-currency.error';

/**
 * FR-EXP-003/BR-EXP-001 — shared by Create Expense, Create Income, and Edit
 * Transaction so currency/category existence checks can't drift between
 * them. Runs both lookups concurrently since they're independent.
 */
export async function validateTransactionReferences(
  currencyRepository: CurrencyRepository,
  categoryRepository: CategoryRepository,
  currency: string,
  categoryId: string,
): Promise<void> {
  const [currencySupported, category] = await Promise.all([
    currencyRepository.isSupported(currency),
    categoryRepository.findById(categoryId),
  ]);

  if (!currencySupported) {
    throw new InvalidCurrencyError(currency);
  }
  if (!category || category.status === 'deprecated') {
    throw new InvalidCategoryError(categoryId);
  }
}
