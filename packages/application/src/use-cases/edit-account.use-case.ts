import { Inject, Injectable } from '@nestjs/common';
import type { Account, AccountEditableFields, AccountRepository } from '@afa/domain';
import { ACCOUNT_REPOSITORY } from '@afa/domain';

import { AccountNotFoundError } from '../errors/account-not-found.error';
import { UnauthorizedAccountAccessError } from '../errors/unauthorized-account-access.error';

export interface EditAccountInput {
  userId: string;
  accountId: string;
  changes: AccountEditableFields;
}

/** FR-FIN-025 — "editing an account's metadata (name, type)"; `currency`/`startingBalance`/`isDefault` are not editable here, per `AccountEditableFields`'s own restriction. */
@Injectable()
export class EditAccountUseCase {
  constructor(@Inject(ACCOUNT_REPOSITORY) private readonly accountRepository: AccountRepository) {}

  async execute(input: EditAccountInput): Promise<Account> {
    const existing = await this.accountRepository.findById(input.accountId);
    if (!existing || existing.isDeleted) {
      throw new AccountNotFoundError(input.accountId);
    }
    // Never trust a client-supplied accountId alone, even under RLS — a
    // fast-path pre-check purely for a clear error message; `update()`'s
    // own atomic conditional `WHERE id = ? AND user_id = ?` is the real
    // guard below, the same split `EditBudgetUseCase` already established.
    if (existing.userId !== input.userId) {
      throw new UnauthorizedAccountAccessError(input.accountId, input.userId);
    }

    const updated = await this.accountRepository.update(
      input.accountId,
      input.userId,
      input.changes,
    );
    if (updated === null) {
      throw new AccountNotFoundError(input.accountId);
    }
    return updated;
  }
}
