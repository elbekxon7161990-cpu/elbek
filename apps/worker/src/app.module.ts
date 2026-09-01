import { Module } from '@nestjs/common';
import { AppConfigModule, AppLoggerModule } from '@afa/shared';
import {
  LlmProviderModule,
  OcrProviderModule,
  PrismaModule,
  QueueModule,
  RedisModule,
  SttProviderModule,
} from '@afa/infrastructure';

import { AccountPurgeModule } from './account-deletion/account-purge.module';
import { BudgetRolloverModule } from './budgets/budget-rollover.module';
import { DebtRemindersModule } from './debts/debt-reminders.module';
import { DomainEventsModule } from './domain-events/domain-events.module';
import { FxRateIngestionModule } from './fx-rates/fx-rate-ingestion.module';
import { OcrModule } from './ocr/ocr.module';
import { ExtractionModelConfigModule } from './providers/extraction-model-config.module';
import { SttModule } from './stt/stt.module';
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
 * `SttModule` (the `@Processor` consuming voice-transcription jobs,
 * `stt-transcription` queue) is now registered — `SttProviderModule` (real
 * OpenAI Whisper, or an explicit `ALLOW_FAKE_STT_PROVIDER` dev fallback —
 * never silent) supplies `STT_PROVIDER`, replacing the previous
 * `SttFallbackModule` placeholder (deleted; per its own doc comment, "must
 * be REPLACED, never extended, once a real STT adapter exists"). A
 * deliberately separate vendor/credential (`GEMINI_API_KEY`) from the
 * Anthropic-backed `LLM_PROVIDER`/`OCR_PROVIDER` above — Claude has no
 * audio-transcription API. This app still never imports
 * @nestjs/platform-express or telegraf — "the Worker must execute queues
 * only."
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
    SttProviderModule,
    OcrModule,
    SttModule,
  ],
})
export class AppModule {}
