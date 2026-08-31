import { Module } from '@nestjs/common';

import { AiExtractionModule } from './ai-extraction.module';
import { ConversationModule } from './conversation.module';
import { DebtModule } from './debt.module';
import { FinanceModule } from './finance.module';
import { ListDraftsUseCase } from '../use-cases/list-drafts.use-case';
import { RouteCallbackQueryUseCase } from '../use-cases/route-callback-query.use-case';
import { RouteDocumentMessageUseCase } from '../use-cases/route-document-message.use-case';
import { RouteOcrDraftCallbackUseCase } from '../use-cases/route-ocr-draft-callback.use-case';
import { RoutePhotoMessageUseCase } from '../use-cases/route-photo-message.use-case';
import { RouteTextMessageUseCase } from '../use-cases/route-text-message.use-case';
import { RouteVoiceMessageUseCase } from '../use-cases/route-voice-message.use-case';

/**
 * TASK-BOT-001 — composes the Bot Application Layer's routing use cases on
 * top of the already-built AI extraction (TASK-AI-002/003), Conversation
 * Engine (TASK-BOT-002), and Finance (TASK-FIN-001) modules, rather than
 * duplicating any of their providers. Does not bind `OBJECT_STORAGE`,
 * `VOICE_TRANSCRIPTION_QUEUE`, `OCR_EXTRACTION_QUEUE`,
 * `CONVERSATION_STATE_REPOSITORY`, `TRANSACTION_COMMIT_PORT`, or any
 * repository token — the composition root's job, same split as every
 * other module in this package.
 *
 * TASK-MVP-002 — re-exports `ConversationModule` itself (not just its
 * `ProcessConversationEventUseCase` provider — NestJS requires re-exporting
 * the whole imported module to pass a provider it declares further up the
 * graph, not just re-listing the class): `TelegramBotService` needs
 * `ProcessConversationEventUseCase` directly (for `/cancel`), and without
 * this explicit re-export it is invisible outside `BotApplicationModule`.
 * Discovered by actually booting the real, full `AppModule` for the first
 * time — never caught before because no test previously did that.
 *
 * TASK-AI-006 (completion round) — `RouteOcrDraftCallbackUseCase` lives
 * here, not `AiExtractionModule`, specifically because it needs
 * `ProcessConversationEventUseCase` (`ConversationModule`, imported here
 * already) — `AiExtractionModule` does not import `ConversationModule` and
 * cannot resolve it.
 *
 * TASK-AI-006 (URGENT follow-up — real AppModule boot fix) — also
 * re-exports `FinanceModule` now, for the exact same reason the
 * TASK-MVP-002 comment above already documents for `ConversationModule`:
 * `TelegramBotService` needs `DeleteTransactionUseCase` (among other
 * `FinanceModule` providers) directly, and without re-exporting the whole
 * module it stays invisible outside `BotApplicationModule`. Pre-existing
 * gap, unrelated to anything else this task changed — found the same way
 * the `ConversationModule` one was: booting the real, full `AppModule` with
 * a real `TELEGRAM_BOT_TOKEN` for the first time.
 */
@Module({
  imports: [AiExtractionModule, ConversationModule, FinanceModule, DebtModule],
  providers: [
    RouteTextMessageUseCase,
    RouteCallbackQueryUseCase,
    RouteVoiceMessageUseCase,
    RoutePhotoMessageUseCase,
    RouteDocumentMessageUseCase,
    ListDraftsUseCase,
    RouteOcrDraftCallbackUseCase,
  ],
  exports: [
    RouteTextMessageUseCase,
    RouteCallbackQueryUseCase,
    RouteVoiceMessageUseCase,
    RoutePhotoMessageUseCase,
    RouteDocumentMessageUseCase,
    ListDraftsUseCase,
    RouteOcrDraftCallbackUseCase,
    ConversationModule,
    DebtModule,
    FinanceModule,
  ],
})
export class BotApplicationModule {}
