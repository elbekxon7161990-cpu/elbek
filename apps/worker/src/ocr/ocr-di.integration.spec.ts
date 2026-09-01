import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ProcessReceiptImageUseCase } from '@afa/application';
import { OCR_PROVIDER } from '@afa/domain';
import {
  AnthropicVisionOcrProvider,
  CircuitBreakerOcrProvider,
  LlmProviderModule,
  OcrProviderModule,
  PrismaModule,
  QueueModule,
  RetryingOcrProvider,
  SttProviderModule,
} from '@afa/infrastructure';

import { ObjectStorageBindingModule } from '../account-deletion/object-storage-binding.module';
import { ExtractionModelConfigModule } from '../providers/extraction-model-config.module';
import { OcrExtractionProcessor } from './ocr-extraction.processor';
import { OcrModule } from './ocr.module';

/**
 * TASK-AI-006 (OCR completion round) — real NestJS DI resolution proof,
 * mirroring `account-purge-di.integration.spec.ts`'s own scoped-import
 * approach: compiles the real, unmodified `OcrModule` plus exactly the
 * modules `apps/worker/src/app.module.ts` actually provides it (`PrismaModule`,
 * `QueueModule.forRoot()`, `ObjectStorageBindingModule`, `LlmProviderModule`,
 * `ExtractionModelConfigModule`, `OcrProviderModule`) — NOT a dynamic import
 * of the full `AppModule`.
 *
 * That full-`AppModule` approach was tried first and rejected: it fails —
 * independently of anything this task touches — because `BudgetRolloverModule`
 * imports `@afa/application`'s `BudgetModule` whole (for
 * `RolloverBudgetPeriodsUseCase`), which eagerly drags in `CreateBudgetUseCase`,
 * which needs `CATEGORY_REPOSITORY`; `apps/worker` never imports
 * `CategoryRepositoryModule` anywhere. This is a genuine, pre-existing gap in
 * `apps/worker/src/budgets/budget-rollover.module.ts` (present before this
 * task touched anything — no OCR-related import removes or shadows it), only
 * surfaced because no prior test had ever compiled the app's full module
 * graph. Per this task's own explicit scope ("do not fix pre-existing
 * architecture issues within this task"), it is disclosed in the final
 * report as a discovered blocker, not fixed here.
 *
 * `.compile()` alone (no `.init()`) proves provider RESOLUTION, not a live
 * Postgres/Redis/Anthropic connection — no network call happens here.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
const HAS_REAL_ANTHROPIC_CREDENTIALS = Boolean(process.env.ANTHROPIC_API_KEY);
if (!HAS_REAL_ANTHROPIC_CREDENTIALS) {
  process.env.ALLOW_FAKE_LLM_PROVIDER ??= 'true';
  process.env.ALLOW_FAKE_OCR_PROVIDER ??= 'true';
}
process.env.ALLOW_FAKE_OBJECT_STORAGE ??= 'true';
if (!process.env.GEMINI_API_KEY) {
  process.env.ALLOW_FAKE_STT_PROVIDER ??= 'true';
}

describe('OcrModule DI / composition-root wiring — real NestJS provider resolution', () => {
  it('resolves OcrExtractionProcessor and ProcessReceiptImageUseCase, with OCR_PROVIDER bound to the real Claude Vision chain when real credentials exist', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        QueueModule.forRoot(),
        ObjectStorageBindingModule,
        LlmProviderModule,
        ExtractionModelConfigModule,
        OcrProviderModule,
        SttProviderModule,
        OcrModule,
      ],
    }).compile();

    expect(moduleRef.get(OcrExtractionProcessor)).toBeInstanceOf(OcrExtractionProcessor);
    expect(moduleRef.get(ProcessReceiptImageUseCase)).toBeInstanceOf(ProcessReceiptImageUseCase);

    const ocrProvider = moduleRef.get(OCR_PROVIDER);
    if (HAS_REAL_ANTHROPIC_CREDENTIALS) {
      expect(ocrProvider).toBeInstanceOf(CircuitBreakerOcrProvider);
      const retrying = (ocrProvider as unknown as { delegate: unknown }).delegate;
      expect(retrying).toBeInstanceOf(RetryingOcrProvider);
      const anthropicVision = (retrying as unknown as { delegate: unknown }).delegate;
      expect(anthropicVision).toBeInstanceOf(AnthropicVisionOcrProvider);
    } else {
      expect(ocrProvider).toBeDefined();
    }

    await moduleRef.close();
  }, 30_000);
});
