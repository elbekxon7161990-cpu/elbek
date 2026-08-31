import { Inject, Injectable } from '@nestjs/common';
import type { Account, AccountRepository } from '@afa/domain';
import { ACCOUNT_REPOSITORY } from '@afa/domain';

export interface ListAccountsInput {
  userId: string;
}

/**
 * Lists a user's active (non-archived, non-deleted) accounts. No balance
 * figure is attached here — FR-FIN-024's live balance computation (§8.14.2)
 * is TASK-FIN-007 Stage G's own scope, not this stage's.
 */
@Injectable()
export class ListAccountsUseCase {
  constructor(@Inject(ACCOUNT_REPOSITORY) private readonly accountRepository: AccountRepository) {}

  async execute(input: ListAccountsInput): Promise<Account[]> {
    return this.accountRepository.findActiveByUserId(input.userId);
  }
}
