import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import type {
  DraftRepository,
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
  NewNotificationData,
  NewTransactionDraftData,
  NotificationDeliveryQueue,
  NotificationRecord,
  NotificationRepository,
  ObjectStoragePort,
  OcrExtractionJobPayload,
  OcrExtractionRequest,
  OcrExtractionResult,
  OcrProvider,
  OcrProviderError,
  TransactionDraftRecord,
} from '@afa/domain';
import {
  ObjectNotFoundError,
  OcrProviderAuthenticationError,
  OcrProviderInvalidImageError,
  OcrProviderMalformedResponseError,
  OcrProviderRateLimitError,
  OcrProviderTimeoutError,
} from '@afa/domain';

import { ValidateStructuredAiOutputUseCase } from './validate-structured-ai-output.use-case';
import { ExtractTransactionCandidatesUseCase } from './extract-transaction-candidates.use-case';
import type { ExtractionModelConfig } from './extract-transaction-candidates.use-case';
import { ProcessReceiptImageUseCase } from './process-receipt-image.use-case';

interface LlmFakeStep {
  result?: LlmCompletionResult;
}

/** Local fake — @afa/application never depends on @afa/infrastructure, even in tests (established convention across every AI-* spec in this package). */
class LocalFakeLlmProvider implements LlmProvider {
  private readonly calls: LlmCompletionRequest[] = [];
  private readonly script: LlmFakeStep[] = [];
  constructor(private readonly defaultResult: LlmCompletionResult) {}
  enqueue(step: LlmFakeStep): this {
    this.script.push(step);
    return this;
  }
  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    this.calls.push(request);
    return this.script.shift()?.result ?? this.defaultResult;
  }
  get callCount(): number {
    return this.calls.length;
  }
  get lastRequest(): LlmCompletionRequest | undefined {
    return this.calls.at(-1);
  }
}

interface OcrFakeStep {
  result?: OcrExtractionResult;
  error?: OcrProviderError;
}

class LocalFakeOcrProvider implements OcrProvider {
  private readonly calls: OcrExtractionRequest[] = [];
  private readonly script: OcrFakeStep[] = [];
  constructor(private readonly defaultResult: OcrExtractionResult) {}
  enqueue(step: OcrFakeStep): this {
    this.script.push(step);
    return this;
  }
  async extractText(request: OcrExtractionRequest): Promise<OcrExtractionResult> {
    this.calls.push(request);
    const next = this.script.shift();
    if (next?.error) throw next.error;
    return next?.result ?? this.defaultResult;
  }
  get callCount(): number {
    return this.calls.length;
  }
  get lastRequest(): OcrExtractionRequest | undefined {
    return this.calls.at(-1);
  }
}

class LocalFakeObjectStorage implements ObjectStoragePort {
  private readonly objects = new Map<string, Buffer>();
  put(uri: string, data: Buffer): void {
    this.objects.set(uri, data);
  }
  async getObject(uri: string): Promise<Buffer> {
    const data = this.objects.get(uri);
    if (!data) throw new ObjectNotFoundError(uri);
    return data;
  }
  async putObject(uri: string, data: Buffer): Promise<void> {
    this.objects.set(uri, data);
  }
  async deleteObject(uri: string): Promise<void> {
    this.objects.delete(uri);
  }
  async deleteObjectsByPrefix(prefix: string): Promise<void> {
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) {
        this.objects.delete(key);
      }
    }
  }
}

/** TASK-AI-006 — local fake, same "no @afa/infrastructure dependency in @afa/application tests" convention. */
class LocalFakeDraftRepository implements DraftRepository {
  readonly drafts = new Map<string, TransactionDraftRecord>();
  async create(data: NewTransactionDraftData): Promise<TransactionDraftRecord> {
    const record: TransactionDraftRecord = {
      ...data,
      status: 'pending',
      resolvedTransactionId: null,
      createdAt: new Date(),
      lastInteractionAt: new Date(),
      deletedAt: null,
    };
    this.drafts.set(data.id, record);
    return record;
  }
  async findById(id: string): Promise<TransactionDraftRecord | null> {
    return this.drafts.get(id) ?? null;
  }
  async findActiveByUserId(userId: string): Promise<TransactionDraftRecord[]> {
    return [...this.drafts.values()].filter((d) => d.userId === userId && d.status === 'pending');
  }
  async updateStatus(id: string): Promise<TransactionDraftRecord> {
    const existing = this.drafts.get(id)!;
    return existing;
  }
}

/** TASK-AI-006 — local fake. Records every notification created, so tests can assert on message/keyboard content without a real DB. */
class LocalFakeNotificationRepository implements NotificationRepository {
  readonly created: NotificationRecord[] = [];
  async create(data: NewNotificationData): Promise<NotificationRecord> {
    const record: NotificationRecord = {
      id: `notif-${this.created.length + 1}`,
      userId: data.userId,
      type: data.type,
      message: data.message,
      dedupKey: data.dedupKey,
      readyToDeliverAt: data.readyToDeliverAt,
      status: data.status ?? 'queued',
      suppressedReason: data.suppressedReason ?? null,
      sentAt: null,
      createdAt: new Date(),
      replyMarkup: data.replyMarkup ?? null,
    };
    this.created.push(record);
    return record;
  }
  async findById(id: string): Promise<NotificationRecord | null> {
    return this.created.find((n) => n.id === id) ?? null;
  }
  async markSent(): Promise<NotificationRecord | null> {
    return null;
  }
  async markFailed(): Promise<NotificationRecord | null> {
    return null;
  }
}

class LocalFakeNotificationDeliveryQueue implements NotificationDeliveryQueue {
  readonly enqueued: { notificationId: string; userId: string }[] = [];
  async enqueue(notificationId: string, userId: string): Promise<void> {
    this.enqueued.push({ notificationId, userId });
  }
}

function ocrResult(overrides: Partial<OcrExtractionResult> = {}): OcrExtractionResult {
  return {
    rawText: 'Korzinka\nTotal: 45000',
    contentClassification: 'receipt',
    detectedLanguage: 'en',
    confidence: 0.9,
    providerModelIdentifier: 'fake-ocr-model',
    processingDurationMs: 500,
    ...overrides,
  };
}

function llmCandidateJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intent: 'EXPENSE',
    amount: 45000,
    currency: 'UZS',
    category: 'FOOD_DINING',
    subcategory: null,
    merchant: 'Korzinka',
    paymentMethod: null,
    transactionDate: '2026-08-14',
    transactionTime: null,
    location: null,
    counterparty: null,
    dueDate: null,
    tags: [],
    description: 'Groceries',
    confidenceScores: {
      intent: 0.97,
      amount: 0.95,
      currency: 0.9,
      category: 0.9,
      transactionDate: 0.95,
    },
    ...overrides,
  };
}

function llmEnvelope(transactions: Record<string, unknown>[]): Record<string, unknown> {
  return {
    transactions,
    detectedLanguage: 'en',
    clarificationNeeded: false,
    clarificationQuestion: null,
  };
}

const IMAGE_URI = 's3://bucket/receipts/msg-1.jpg';

function payload(overrides: Partial<OcrExtractionJobPayload> = {}): OcrExtractionJobPayload {
  return {
    jobId: 'job-1',
    userId: 'user-1',
    telegramFileId: 'AgACAgIA...',
    imageObjectStorageUri: IMAGE_URI,
    mimeType: 'image/jpeg',
    sizeBytes: 500_000,
    sourceType: 'photo',
    caption: null,
    currentDateTime: '2026-08-14T10:00:00+05:00',
    userDefaultCurrency: 'UZS',
    userRecentCategories: ['FOOD_DINING'],
    ...overrides,
  };
}

function buildUseCase(
  ocrProvider: OcrProvider,
  storage: LocalFakeObjectStorage,
  llmResultJson: Record<string, unknown> = llmEnvelope([llmCandidateJson()]),
) {
  const llmProvider = new LocalFakeLlmProvider({
    content: JSON.stringify(llmResultJson),
    finishReason: 'stop',
  });
  const validate = new ValidateStructuredAiOutputUseCase(llmProvider);
  const config: ExtractionModelConfig = { model: 'fixture-model' };
  const extract = new ExtractTransactionCandidatesUseCase(validate, config);
  const draftRepository = new LocalFakeDraftRepository();
  const notificationRepository = new LocalFakeNotificationRepository();
  const deliveryQueue = new LocalFakeNotificationDeliveryQueue();
  const useCase = new ProcessReceiptImageUseCase(
    storage,
    ocrProvider,
    draftRepository,
    notificationRepository,
    deliveryQueue,
    extract,
  );
  return { useCase, llmProvider, draftRepository, notificationRepository, deliveryQueue };
}

function storageWithImage(): LocalFakeObjectStorage {
  const storage = new LocalFakeObjectStorage();
  storage.put(IMAGE_URI, Buffer.from('fake-jpeg-bytes'));
  return storage;
}

describe('ProcessReceiptImageUseCase', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('processes a valid receipt photo end to end', async () => {
    const { useCase } = buildUseCase(new LocalFakeOcrProvider(ocrResult()), storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('extracted');
    if (outcome.status === 'extracted') {
      expect(outcome.extraction.status).toBe('valid');
      expect(outcome.ocrResult.contentClassification).toBe('receipt');
      expect(outcome.draftId).toEqual(expect.any(String));
    }
  });

  it('processes a valid screenshot, passing the screenshot content hint to the provider (FR-SCR-001)', async () => {
    const ocr = new LocalFakeOcrProvider(
      ocrResult({
        contentClassification: 'screenshot',
        rawText: 'Card ****1234\n-240,000 UZS\nDebited',
      }),
    );
    const { useCase } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload({ sourceType: 'screenshot' }));

    expect(outcome.status).toBe('extracted');
    expect(ocr.lastRequest?.contentHint).toBe('screenshot');
  });

  it('processes an Uzbek-language receipt', async () => {
    const ocr = new LocalFakeOcrProvider(
      ocrResult({ rawText: "Do'kon\n45000 so'm", detectedLanguage: 'uz' }),
    );
    const { useCase, llmProvider } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('extracted');
    expect(llmProvider.lastRequest?.messages[0]?.content).toContain("45000 so'm");
    if (outcome.status === 'extracted') {
      expect(outcome.ocrResult.detectedLanguage).toBe('uz');
    }
  });

  it('processes a Russian-language receipt (Cyrillic script)', async () => {
    const ocr = new LocalFakeOcrProvider(
      ocrResult({ rawText: 'Магазин\nИтого: 45000 сум', detectedLanguage: 'ru' }),
    );
    const { useCase } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('extracted');
    if (outcome.status === 'extracted') {
      expect(outcome.ocrResult.rawText).toContain('Итого');
    }
  });

  it('processes an English-language receipt (Latin script)', async () => {
    const ocr = new LocalFakeOcrProvider(
      ocrResult({ rawText: 'Corner Store\nTotal: $45.00', detectedLanguage: 'en' }),
    );
    const { useCase } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('extracted');
  });

  it('never translates OCR text before extraction — preserves the original script/language verbatim', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult({ rawText: 'Магазин Корзинка' }));
    const { useCase, llmProvider } = buildUseCase(ocr, storageWithImage());

    await useCase.execute(payload());

    expect(llmProvider.lastRequest?.messages[0]?.content).toContain('Магазин Корзинка');
  });

  it('surfaces (but does not act on) low OCR-provider confidence from a blurry/dark/low-resolution image — extraction still proceeds, downstream confidence-gating decides', async () => {
    const ocr = new LocalFakeOcrProvider(
      ocrResult({ confidence: 0.2, rawText: 'K0rz1nk4\nT0t4l: 45O00' }),
    );
    const { useCase } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('extracted');
    if (outcome.status === 'extracted') {
      expect(outcome.ocrResult.ocrConfidence).toBe(0.2);
    }
  });

  it('normalizes a garbled digit-context OCR misread from a rotated/blurry image before extraction', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult({ rawText: 'Total: 45O00' }));
    const { useCase, llmProvider } = buildUseCase(ocr, storageWithImage());

    await useCase.execute(payload());

    expect(llmProvider.lastRequest?.messages[0]?.content).toContain('Total: 45000');
  });

  it('rejects a corrupted/empty image before ever calling the OCR provider', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult());
    const { useCase } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload({ sizeBytes: 0 }));

    expect(outcome).toEqual({ status: 'invalid_image', reason: 'EMPTY_IMAGE' });
    expect(ocr.callCount).toBe(0);
  });

  it('rejects an unsupported MIME type before calling the OCR provider', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult());
    const { useCase } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload({ mimeType: 'image/gif' }));

    expect(outcome).toEqual({ status: 'invalid_image', reason: 'UNSUPPORTED_FORMAT' });
    expect(ocr.callCount).toBe(0);
  });

  it('rejects an oversized file before calling the OCR provider', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult());
    const { useCase } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload({ sizeBytes: 100 * 1024 * 1024 }));

    expect(outcome).toEqual({ status: 'invalid_image', reason: 'OVERSIZED' });
  });

  it('reports a storage failure when the referenced image object does not exist, and sends an honest failure notification', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult());
    const { useCase, notificationRepository, deliveryQueue } = buildUseCase(
      ocr,
      new LocalFakeObjectStorage(),
    ); // nothing uploaded

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('storage_failure');
    expect(notificationRepository.created).toHaveLength(1);
    expect(notificationRepository.created[0]!.replyMarkup).toBeNull();
    expect(deliveryQueue.enqueued).toHaveLength(1);
  });

  it('treats an empty OCR result as a total pipeline failure (FR-INP-030), never proceeding to extraction', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult({ rawText: '' }));
    const { useCase, llmProvider } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('ocr_failed');
    expect(llmProvider.callCount).toBe(0);
  });

  it('treats a whitespace-only OCR result as empty', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult({ rawText: '   \n  ' }));
    const { useCase } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('ocr_failed');
  });

  it('succeeds when the OCR provider succeeds (baseline)', async () => {
    const { useCase } = buildUseCase(new LocalFakeOcrProvider(ocrResult()), storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('extracted');
  });

  it('maps a malformed OCR provider response to ocr_failed and sends an honest failure notification', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult());
    ocr.enqueue({ error: new OcrProviderMalformedResponseError('fake') });
    const { useCase, notificationRepository } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('ocr_failed');
    expect(notificationRepository.created).toHaveLength(1);
  });

  it('maps a provider timeout to ocr_failed', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult());
    ocr.enqueue({ error: new OcrProviderTimeoutError('fake', 10_000) });
    const { useCase } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('ocr_failed');
  });

  it('maps a provider rate-limit error to ocr_failed', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult());
    ocr.enqueue({ error: new OcrProviderRateLimitError('fake', 5000) });
    const { useCase } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('ocr_failed');
  });

  it('maps a provider authentication error to ocr_failed', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult());
    ocr.enqueue({ error: new OcrProviderAuthenticationError('fake') });
    const { useCase } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('ocr_failed');
  });

  it('maps a corrupted-image provider rejection to ocr_failed', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult());
    ocr.enqueue({ error: new OcrProviderInvalidImageError('fake', 'corrupted') });
    const { useCase } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('ocr_failed');
  });

  it('is idempotent — a redelivered job for the exact same telegramFileId resolves to the same draft, never a second one', async () => {
    const { useCase, draftRepository, notificationRepository } = buildUseCase(
      new LocalFakeOcrProvider(ocrResult()),
      storageWithImage(),
    );

    const first = await useCase.execute(payload());
    const second = await useCase.execute(payload()); // same telegramFileId

    expect(first.status).toBe('extracted');
    expect(second).toEqual({
      status: 'already_processed',
      draftId: (first as { draftId: string }).draftId,
    });
    expect(draftRepository.drafts.size).toBe(1);
    // Only the first run's success notification — the redelivered job never
    // sends a second Telegram message.
    expect(notificationRepository.created).toHaveLength(1);
  });

  it('a different telegramFileId always gets its own, independent draft', async () => {
    const { useCase, draftRepository } = buildUseCase(
      new LocalFakeOcrProvider(ocrResult()),
      storageWithImage(),
    );

    await useCase.execute(payload({ telegramFileId: 'file-a' }));
    await useCase.execute(payload({ telegramFileId: 'file-b' }));

    expect(draftRepository.drafts.size).toBe(2);
  });

  it('prepends the caption to the OCR text as combined input, taking precedence (§6.13.4)', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult({ rawText: 'Total: 45000' }));
    const { useCase, llmProvider } = buildUseCase(ocr, storageWithImage());

    await useCase.execute(payload({ caption: 'lunch with the team' }));

    const sentText = llmProvider.lastRequest?.messages[0]?.content ?? '';
    expect(sentText).toContain('lunch with the team');
    expect(sentText).toContain('Total: 45000');
    expect(sentText.indexOf('lunch with the team')).toBeLessThan(sentText.indexOf('Total: 45000'));
  });

  it('extraction integration: reuses ExtractTransactionCandidatesUseCase unchanged — the same extraction call intent/entity logic (TASK-AI-002) applies to OCR text', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult());
    const { useCase } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('extracted');
    if (outcome.status === 'extracted' && outcome.extraction.status === 'valid') {
      expect(outcome.extraction.output.transactions[0]?.intent).toBe('EXPENSE');
    }
  });

  it('hallucination-prevention integration: a fabricated merchant not present in the OCR text is nulled by the reused TASK-AI-003 grounding layer', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult({ rawText: 'Total: 45000' })); // no merchant name anywhere in the OCR text
    const { useCase } = buildUseCase(
      ocr,
      storageWithImage(),
      llmEnvelope([llmCandidateJson({ merchant: 'Cafe Somewhere' })]),
    );

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('extracted');
    if (outcome.status === 'extracted' && outcome.extraction.status === 'valid') {
      expect(outcome.extraction.output.transactions[0]?.merchant).toBeNull();
    }
  });

  it('confidence-evaluation integration: candidateReports (built by the reused TASK-AI-003 layer, consumed by TASK-AI-004) are present on the outcome', async () => {
    const { useCase } = buildUseCase(new LocalFakeOcrProvider(ocrResult()), storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('extracted');
    if (outcome.status === 'extracted' && outcome.extraction.status === 'valid') {
      expect(outcome.extraction.candidateReports).toHaveLength(1);
      expect(outcome.extraction.candidateReports[0]).toHaveProperty('classification');
    }
  });

  it('surfaces currency and merchant candidate signals without deciding the final values (FR-INP-040/043)', async () => {
    const ocr = new LocalFakeOcrProvider(ocrResult({ rawText: "Korzinka\nTotal: 45000 so'm" }));
    const { useCase } = buildUseCase(ocr, storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('extracted');
    if (outcome.status === 'extracted') {
      expect(outcome.ocrResult.currencyCandidates).toContain('UZS');
      expect(outcome.ocrResult.merchantCandidate).toBe('Korzinka');
    }
  });

  it('carries the image object storage URI through into the structured result (FR-OCR-007 linkage)', async () => {
    const { useCase } = buildUseCase(new LocalFakeOcrProvider(ocrResult()), storageWithImage());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('extracted');
    if (outcome.status === 'extracted') {
      expect(outcome.ocrResult.imageObjectStorageUri).toBe(IMAGE_URI);
      expect(outcome.ocrResult.sourceType).toBe('photo');
    }
  });

  it('never logs the image bytes, OCR text, or receipt content to the console', async () => {
    const ocr = new LocalFakeOcrProvider(
      ocrResult({ rawText: 'sensitive financial detail 45000' }),
    );
    const { useCase } = buildUseCase(ocr, storageWithImage());

    await useCase.execute(payload());

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('propagates a non-provider, non-storage error (unexpected infrastructure fault) rather than masking it', async () => {
    const ocr: OcrProvider = {
      extractText: () => {
        throw new Error('unexpected infra fault');
      },
    };
    const { useCase } = buildUseCase(ocr, storageWithImage());

    await expect(useCase.execute(payload())).rejects.toThrow('unexpected infra fault');
  });

  describe('TASK-AI-006 completion round — draft creation and review delivery', () => {
    it('creates a real TransactionDraftRecord for a successfully extracted candidate', async () => {
      const { useCase, draftRepository } = buildUseCase(
        new LocalFakeOcrProvider(ocrResult()),
        storageWithImage(),
      );

      const outcome = await useCase.execute(payload());

      expect(outcome.status).toBe('extracted');
      const draftId = (outcome as { draftId: string }).draftId;
      const draft = await draftRepository.findById(draftId);
      expect(draft).not.toBeNull();
      expect(draft!.status).toBe('pending');
      expect(draft!.sourceType).toBe('photo');
      expect(draft!.userId).toBe('user-1');
      expect(draft!.partialData.amount).toBe(45000);
    });

    it('enqueues a Telegram review notification with a Confirm/Edit/Cancel keyboard referencing the draft id', async () => {
      const { useCase, notificationRepository, deliveryQueue } = buildUseCase(
        new LocalFakeOcrProvider(ocrResult()),
        storageWithImage(),
      );

      const outcome = await useCase.execute(payload());
      const draftId = (outcome as { draftId: string }).draftId;

      expect(notificationRepository.created).toHaveLength(1);
      const notification = notificationRepository.created[0]!;
      expect(notification.type).toBe('ReceiptOcrDraftReady');
      expect(notification.message).toContain('45000');
      expect(notification.replyMarkup).not.toBeNull();
      const flatButtons = notification.replyMarkup!.flat();
      expect(flatButtons.some((b) => b.callback_data === `ocrdraft_confirm:${draftId}`)).toBe(true);
      expect(flatButtons.some((b) => b.callback_data === `ocrdraft_edit:${draftId}`)).toBe(true);
      expect(flatButtons.some((b) => b.callback_data === `ocrdraft_cancel:${draftId}`)).toBe(true);
      expect(deliveryQueue.enqueued).toEqual([
        { notificationId: notification.id, userId: 'user-1' },
      ]);
    });

    it('when the receipt text has no transaction-shaped content, sends an honest failure notification and creates no draft', async () => {
      const ocr = new LocalFakeOcrProvider(ocrResult({ rawText: 'Just a logo, no numbers' }));
      const { useCase, draftRepository, notificationRepository } = buildUseCase(
        ocr,
        storageWithImage(),
        llmEnvelope([]), // no transactions extracted
      );

      const outcome = await useCase.execute(payload());

      expect(outcome).toEqual({ status: 'no_transaction_detected' });
      expect(draftRepository.drafts.size).toBe(0);
      expect(notificationRepository.created).toHaveLength(1);
      expect(notificationRepository.created[0]!.replyMarkup).toBeNull();
    });

    it('sends a failure notification (no keyboard) for an invalid image outcome only when reached past validation — validation itself sends none, matching the existing pre-flight short-circuit', async () => {
      const { useCase, notificationRepository } = buildUseCase(
        new LocalFakeOcrProvider(ocrResult()),
        storageWithImage(),
      );

      await useCase.execute(payload({ sizeBytes: 0 }));

      // Pre-flight validation failures are a distinct, much higher-volume
      // case (any corrupted upload) than a real OCR/extraction failure —
      // deliberately not notified to avoid spamming a user who, e.g., sent
      // a 0-byte file by a client glitch. See this task's own final report.
      expect(notificationRepository.created).toHaveLength(0);
    });
  });
});
