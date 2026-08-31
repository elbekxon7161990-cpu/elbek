import { Module } from '@nestjs/common';
import { AppConfigModule, AppLoggerModule } from '@afa/shared';
import { LlmProviderModule, OcrProviderModule, PrismaModule, QueueModule, RedisModule } from '@afa/infrastructure';

import { AccountPurgeModule } from './account-deletion/account-purge.module';
import { BudgetRolloverModule } from './budgets/budget-rollover.module';
import { DebtRemindersModule } from './debts/debt-reminders.module';
import { DomainEventsModule } from './domain-events/domain-events.module';
import { FxRateIngestionModule } from './fx-rates/fx-rate-ingestion.module';
import { OcrModule } from './ocr/ocr.module';
import { ExtractionModelConfigModule } from './providers/extraction-model-config.module';
import { SttFallbackModule } from './providers/stt-fallback.module';
import { SupportSessionExpiryModule } from './support-sessions/support-session-expiry.module';

/**
 * Loads what apps/worker requires: config, logging, the BullMQ connection,
 * the persistence layer, FR-DB-015's domain-event dispatch worker, and the
 * Debt Reminder Producer's scheduled eligibility scan (`DebtRemindersModule`
 * — queries `debts` directly, emits via the existing, unmodified
 * `DomainEventRepository.record()`; does not touch FR-DB-015's own
 * dispatcher or TASK-BOT-009's consumer), TASK-FIN-003's own Budget
 * period-rollover scan (`BudgetRolloverModule`, FR-BUD-003/NFR-BUD-002),
 * and TASK-AUTH-006's own scheduled account-purge scan (`AccountPurgeModule`,
 * FR-RET-002 — see that module's own `ObjectStorageBindingModule` import
 * for a disclosed, narrow exception to the "no concrete OBJECT_STORAGE
 * provider exists yet" status every other feature here used to have).
 *
 * TASK-AI-006 (OCR completion round) — `OcrModule` is now registered
 * (previously deliberately excluded, per its own doc comment, pending a
 * real `OCR_PROVIDER`/`LLM_PROVIDER`/`EXTRACTION_MODEL_CONFIG` binding).
 * `LlmProviderModule` + `ExtractionModelConfigModule` are new imports here
 * too — `OcrModule` -> `AiExtractionModule` -> `ExtractTransactionCandidatesUseCase`
 * needs both to resolve, and this app never bound either before now (it
 * was never LLM-capable). `OcrProviderModule` (real Claude Vision, or an
 * explicit `ALLOW_FAKE_OCR_PROVIDER` dev fallback — never silent) supplies
 * `OCR_PROVIDER` itself. `OBJECT_STORAGE`/`DRAFT_REPOSITORY`/
 * `NOTIFICATION_REPOSITORY`/`NOTIFICATION_DELIVERY_QUEUE` are already
 * available here (the first via `AccountPurgeModule`'s own
 * `ObjectStorageBindingModule`, `@Global()`; the drafts/notification ones
 * are bound below in `OcrModule`'s own import list).
 *
 * `SttModule` (the `@Processor` consuming voice-transcription jobs) remains
 * deliberately unregistered — no real STT provider exists yet (a separate,
 * not-yet-started decision, per this task's own scope). This app still never
 * imports @nestjs/platform-express or telegraf — "the Worker must execute
 * queues only." `SttFallbackModule` is registered anyway, for a narrower
 * reason: `OcrModule` -> `AiExtractionModule` bundles
 * `TranscribeVoiceMessageUseCase` together with `ProcessReceiptImageUseCase`
 * (one shared application module, not split per modality), so `STT_PROVIDER`
 * must resolve for `AiExtractionModule` itself to instantiate, even though
 * nothing in this app ever calls that use-case — see that module's own doc
 * comment.
 */
@Module({
  imports: [
    AppConfigModule.forRoot(),
    AppLoggerModule.forRoot('afa-worker'),
    PrismaModule,
    RedisModule,
    QueueModule.forRoot(),
    DomainEventsModule,
    DebtRemindersModule,
    BudgetRolloverModule,
    FxRateIngestionModule,
    AccountPurgeModule,
    SupportSessionExpiryModule,
    LlmProviderModule,
    ExtractionModelConfigModule,
    OcrProviderModule,
    SttFallbackModule,
    OcrModule,
  ],
})
export class AppModule {}
