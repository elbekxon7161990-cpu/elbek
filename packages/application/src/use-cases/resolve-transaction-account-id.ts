import type { AccountRepository } from '@afa/domain';

import { AccountNotFoundError } from '../errors/account-not-found.error';
import { UnauthorizedAccountAccessError } from '../errors/unauthorized-account-access.error';

/**
 * TASK-FIN-007 (Stage E, FR-FIN-023) — shared by `CreateExpenseUseCase`/
 * `CreateIncomeUseCase` so the resolution logic can't drift between them,
 * the same "shared by Create Expense and Create Income" pattern
 * `validateTransactionReferences` already established.
 *
 * An explicitly-supplied `accountId` is validated for existence, ownership,
 * and non-deletion (the same rigor `EditAccountUseCase`/`DeleteAccountUseCase`
 * already apply) — its `currency` is never cross-checked against the
 * transaction's own currency; no FR requires that, and inventing the
 * restriction would block a legitimate case (e.g. paying in USD from a
 * UZS-denominated wallet). When omitted, resolves the user's implicit
 * per-currency default account (§8.12.4), never a bare `null`.
 */
export async function resolveTransactionAccountId(
  accountRepository: AccountRepository,
  userId: string,
  currency: string,
  accountId: string | undefined,
): Promise<string> {
  if (accountId === undefined) {
    const account = await accountRepository.findOrCreateDefaultForCurrency(userId, currency);
    return account.id;
  }

  const account = await accountRepository.findById(accountId);
  if (!account || account.isDeleted) {
    throw new AccountNotFoundError(accountId);
  }
  if (account.userId !== userId) {
    throw new UnauthorizedAccountAccessError(accountId, userId);
  }
  return account.id;
}
