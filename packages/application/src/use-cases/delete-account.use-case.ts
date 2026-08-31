import { Inject, Injectable } from '@nestjs/common';
import type { Account, AccountRepository } from '@afa/domain';
import { ACCOUNT_REPOSITORY } from '@afa/domain';

import { AccountNotFoundError } from '../errors/account-not-found.error';
import { UnauthorizedAccountAccessError } from '../errors/unauthorized-account-access.error';

export interface DeleteAccountInput {
  userId: string;
  accountId: string;
}

/**
 * FR-FIN-025 — "archiving (soft-deleting) an account ... an archived
 * account's historical transactions remain queryable." `AccountRepository`
 * has no separate hard-delete method (Stage B design) — "delete" here means
 * `archive()`, the same non-destructive pattern FR-EXP-006 already
 * established and FR-FIN-025 explicitly cites.
 */
@Injectable()
export class DeleteAccountUseCase {
  constructor(@Inject(ACCOUNT_REPOSITORY) private readonly accountRepository: AccountRepository) {}

  async execute(input: DeleteAccountInput): Promise<Account> {
    const existing = await this.accountRepository.findById(input.accountId);
    if (!existing || existing.isDeleted) {
      throw new AccountNotFoundError(input.accountId);
    }
    if (existing.userId !== input.userId) {
      throw new UnauthorizedAccountAccessError(input.accountId, input.userId);
    }

    const archived = await this.accountRepository.archive(input.accountId, input.userId);
    if (archived === null) {
      throw new AccountNotFoundError(input.accountId);
    }
    return archived;
  }
}
