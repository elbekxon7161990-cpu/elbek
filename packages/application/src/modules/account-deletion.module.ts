import { Module } from '@nestjs/common';

import { CancelAccountDeletionUseCase } from '../use-cases/cancel-account-deletion.use-case';
import { RequestAccountDeletionUseCase } from '../use-cases/request-account-deletion.use-case';

/**
 * TASK-AUTH-006 — does not bind `USER_REPOSITORY`; binding domain ports to
 * real implementations is the composition root's job, the same split every
 * other module in this package already established.
 *
 * Deliberately does NOT also export `PurgeExpiredAccountsUseCase` (see
 * `account-purge.module.ts`, a separate module for exactly that use case) —
 * `apps/telegram-bot` imports THIS module for its `/deleteaccount`
 * request/cancel flow only, and has no business needing
 * `ACCOUNT_PURGE_REPOSITORY`/`ACCOUNT_PURGE_NOTIFICATION_QUEUE` resolvable
 * in its own DI graph at all. Bundling the purge use case in here originally
 * broke exactly that: NestJS resolves every provider a module declares
 * eagerly once the module is imported anywhere, so `apps/telegram-bot`
 * importing this module would have forced it to also bind the purge
 * repository and notification queue it never uses — caught by
 * `account-deletion-di.integration.spec.ts`'s own real `.compile()` (not a
 * mocked-provider unit test), exactly the kind of wiring bug that class of
 * test exists to catch.
 */
@Module({
  providers: [RequestAccountDeletionUseCase, CancelAccountDeletionUseCase],
  exports: [RequestAccountDeletionUseCase, CancelAccountDeletionUseCase],
})
export class AccountDeletionModule {}
