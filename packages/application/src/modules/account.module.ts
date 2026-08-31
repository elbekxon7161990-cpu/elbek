import { Module } from '@nestjs/common';

import { CreateAccountUseCase } from '../use-cases/create-account.use-case';
import { DeleteAccountUseCase } from '../use-cases/delete-account.use-case';
import { EditAccountUseCase } from '../use-cases/edit-account.use-case';
import { ListAccountsUseCase } from '../use-cases/list-accounts.use-case';

/**
 * TASK-FIN-007 Stage D (Chapter 8 §8.12) — Account CRUD use cases. Does not
 * bind USER_REPOSITORY/CURRENCY_REPOSITORY/ACCOUNT_REPOSITORY — same split
 * as `BudgetModule`: binding those domain ports to their infrastructure
 * implementations is the composition root's job, imported alongside this
 * module by whichever apps/* app needs it.
 */
@Module({
  providers: [CreateAccountUseCase, EditAccountUseCase, DeleteAccountUseCase, ListAccountsUseCase],
  exports: [CreateAccountUseCase, EditAccountUseCase, DeleteAccountUseCase, ListAccountsUseCase],
})
export class AccountModule {}
