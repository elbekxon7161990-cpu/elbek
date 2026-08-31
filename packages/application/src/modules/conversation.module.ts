import { Module } from '@nestjs/common';

import { FinanceModule } from './finance.module';
import { ProcessConversationEventUseCase } from '../use-cases/process-conversation-event.use-case';

/**
 * TASK-BOT-002 — does not bind `CONVERSATION_STATE_REPOSITORY`,
 * `TRANSACTION_COMMIT_PORT`, or `DRAFT_REPOSITORY`; no concrete Redis
 * adapter, transaction-commit adapter, or Prisma draft adapter exists here.
 * Binding them to a real (or fake, for tests) implementation is the
 * composition root's job, same split as every other *Module in this
 * codebase (see AiExtractionModule's own note).
 *
 * TASK-BOT-004 — imports `FinanceModule` so `ProcessConversationEventUseCase`
 * can resolve `DeleteTransactionUseCase` (its Undo side effect, see that
 * class's own doc comment) from the same injector graph.
 */
@Module({
  imports: [FinanceModule],
  providers: [ProcessConversationEventUseCase],
  exports: [ProcessConversationEventUseCase],
})
export class ConversationModule {}
