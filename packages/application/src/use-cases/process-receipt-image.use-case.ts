import { Inject, Injectable } from '@nestjs/common';
import type { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type {
  DetectedLanguage,
  DraftRepository,
  ImageValidationFailureReason,
  NotificationDeliveryQueue,
  NotificationRepository,
  ObjectStoragePort,
  OcrExtractionJobPayload,
  OcrProvider,
  StructuredOcrResult,
} from '@afa/domain';
import {
  DRAFT_REPOSITORY,
  NOTIFICATION_DELIVERY_QUEUE,
  NOTIFICATION_REPOSITORY,
  OBJECT_STORAGE,
  OCR_PROVIDER,
  ObjectStorageError,
  OcrProviderError,
  buildOcrDraftReviewKeyboard,
  computeRequiredFields,
  detectCurrencyCandidates,
  detectMerchantCandidate,
  evaluateImageValidity,
  normalizeOcrText,
  renderOcrDraftReviewMessage,
  renderOcrExtractionFailedMessage,
  renderOcrNoTransactionDetectedMessage,
} from '@afa/domain';

import { ExtractTransactionCandidatesUseCase } from './extract-transaction-candidates.use-case';
import type { ExtractionOutcome } from './extract-transaction-candidates.use-case';

export interface InvalidImageOutcome {
  status: 'invalid_image';
  reason: ImageValidationFailureReason;
}

export interface OcrStorageFailureOutcome {
  status: 'storage_failure';
  reason: string;
}

/** FR-OCR-006's "ask directly for the amount" fallback for a total, pipeline-level OCR failure — mirrors FR-STT-007's `stt_failed`. */
export interface OcrFailedOutcome {
  status: 'ocr_failed';
  reason: string;
}

/** The image OCR'd fine but no transaction-shaped content was found in the resulting text. */
export interface OcrNoTransactionDetectedOutcome {
  status: 'no_transaction_detected';
}

/**
 * A draft already exists for this exact `telegramFileId` — a BullMQ
 * redelivery of the same job (at-least-once delivery) safely no-ops rather
 * than creating a second draft and sending a second Telegram review card.
 */
export interface AlreadyProcessedOutcome {
  status: 'already_processed';
  draftId: string;
}

/** AC-INP-002-style path — OCR succeeded structurally and a review draft was created; the user has been notified with a Confirm/Edit/Cancel card. */
export interface ExtractedOutcome {
  status: 'extracted';
  ocrResult: StructuredOcrResult;
  extraction: ExtractionOutcome;
  draftId: string;
}

export type ProcessReceiptImageOutcome =
  | InvalidImageOutcome
  | OcrStorageFailureOutcome
  | OcrFailedOutcome
  | OcrNoTransactionDetectedOutcome
  | AlreadyProcessedOutcome
  | ExtractedOutcome;

/** TASK-AI-006 — a deterministic, `transaction_drafts.id`-shaped (`UUID`) draft id derived from `telegramFileId`, so a redelivered OCR job for the exact same Telegram photo always resolves to the exact same draft row instead of creating a duplicate. Not a security boundary (drafts are still RLS/userId-scoped) — purely an idempotency key, mirroring `RoutePhotoMessageUseCase`'s own `jobId = 'ocr-${telegramFileId}'` precedent at the queue layer, applied one layer deeper. */
function deterministicDraftId(telegramFileId: string): string {
  const hex = createHash('sha256').update(`ocr-draft:${telegramFileId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * TASK-AI-006 (Chapter 6 §6.3/§6.6/§6.13) — the Image Preprocessor + OCR
 * Provider + Extraction Support Functions steps from §6.13.2's sequence
 * diagram, composed as one use case, mirroring TASK-AI-005's
 * `TranscribeVoiceMessageUseCase` exactly. Extended (this task's own
 * completion round) to close the hand-off the earlier round left open: a
 * successful extraction now genuinely produces a `TransactionDraftRecord`
 * (reusing `DraftRepository` unchanged — the same port/table the text
 * pathway already uses) and an async Telegram review notification (reusing
 * `NotificationRepository`/`NotificationDeliveryQueue`/
 * `NotificationDeliveryProcessor` directly — NOT `NotificationDeliveryConsumer`'s
 * preference/dedup/quiet-hours gating, which exists for ambient background
 * notifications like debt reminders and would be actively wrong here: a
 * user who just sent a photo wants their review card immediately, never
 * delayed to the end of quiet hours or suppressed by an unrelated dedup
 * window).
 *
 * Every non-`extracted` outcome ALSO now sends an honest, plain-text
 * failure notification (AI-P6, "never silent failure") — before this
 * round, a failed OCR job produced no user-visible signal at all.
 *
 * Still never talks to Telegram directly and never writes to Prisma's
 * `transactions` table itself — draft creation and notification are as far
 * as this use case's own boundary goes; the actual commit only happens once
 * the user taps Confirm (`RouteOcrDraftCallbackUseCase`).
 */
@Injectable()
export class ProcessReceiptImageUseCase {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStoragePort,
    @Inject(OCR_PROVIDER) private readonly ocrProvider: OcrProvider,
    @Inject(DRAFT_REPOSITORY) private readonly draftRepository: DraftRepository,
    @Inject(NOTIFICATION_REPOSITORY) private readonly notificationRepository: NotificationRepository,
    @Inject(NOTIFICATION_DELIVERY_QUEUE) private readonly deliveryQueue: NotificationDeliveryQueue,
    private readonly extractTransactionCandidatesUseCase: ExtractTransactionCandidatesUseCase,
  ) {}

  async execute(payload: OcrExtractionJobPayload): Promise<ProcessReceiptImageOutcome> {
    const validation = evaluateImageValidity({
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
    });
    if (!validation.valid) {
      return { status: 'invalid_image', reason: validation.reason };
    }

    const draftId = deterministicDraftId(payload.telegramFileId);
    const existingDraft = await this.draftRepository.findById(draftId);
    if (existingDraft !== null) {
      return { status: 'already_processed', draftId };
    }

    let image: Buffer;
    try {
      image = await this.objectStorage.getObject(payload.imageObjectStorageUri);
    } catch (error) {
      if (error instanceof ObjectStorageError) {
        await this.notifyFailure(payload, renderOcrExtractionFailedMessage);
        return { status: 'storage_failure', reason: error.message };
      }
      throw error;
    }

    let rawText: string;
    let contentClassification: StructuredOcrResult['contentClassification'];
    let detectedLanguage: StructuredOcrResult['detectedLanguage'];
    let ocrConfidence: number;
    let providerModelIdentifier: string;
    try {
      const ocrResult = await this.ocrProvider.extractText({
        image,
        mimeType: payload.mimeType,
        contentHint: payload.sourceType === 'screenshot' ? 'screenshot' : 'receipt',
      });
      rawText = ocrResult.rawText;
      contentClassification = ocrResult.contentClassification;
      detectedLanguage = ocrResult.detectedLanguage;
      ocrConfidence = ocrResult.confidence;
      providerModelIdentifier = ocrResult.providerModelIdentifier;
    } catch (error) {
      if (error instanceof OcrProviderError) {
        await this.notifyFailure(payload, renderOcrExtractionFailedMessage);
        return { status: 'ocr_failed', reason: error.message };
      }
      throw error;
    }

    const normalizedText = normalizeOcrText(rawText);
    if (normalizedText.length === 0) {
      await this.notifyFailure(payload, renderOcrExtractionFailedMessage);
      return {
        status: 'ocr_failed',
        reason: 'Provider returned an empty OCR result (FR-INP-030).',
      };
    }

    const ocrResult: StructuredOcrResult = {
      rawText,
      normalizedText,
      contentClassification,
      detectedLanguage,
      ocrConfidence,
      currencyCandidates: detectCurrencyCandidates(normalizedText),
      merchantCandidate: detectMerchantCandidate(normalizedText),
      providerModelIdentifier,
      imageObjectStorageUri: payload.imageObjectStorageUri,
      sourceType: payload.sourceType,
      processedAt: new Date().toISOString(),
    };

    const inputText = payload.caption ? `${payload.caption}\n${normalizedText}` : normalizedText;

    const extraction = await this.extractTransactionCandidatesUseCase.execute({
      currentDateTime: payload.currentDateTime,
      userDefaultCurrency: payload.userDefaultCurrency,
      userRecentCategories: payload.userRecentCategories,
      pendingClarificationContext: null,
      inputText,
    });

    if (extraction.status !== 'valid') {
      await this.notifyFailure(payload, renderOcrExtractionFailedMessage);
      return { status: 'ocr_failed', reason: extraction.reason };
    }

    // FR-OCR-008 (MVP: single-photo, single-transaction scope) — a receipt
    // yields at most one candidate; multi-item receipts (P2, out of MVP
    // scope) would need a second, not-yet-built review flow, not this one.
    const candidate = extraction.output.transactions[0];
    if (candidate === undefined) {
      await this.notifyFailure(payload, renderOcrNoTransactionDetectedMessage);
      return { status: 'no_transaction_detected' };
    }

    const candidateRecord = candidate as unknown as Record<string, unknown>;
    const missingFields = computeRequiredFields(candidate).filter(
      (field) => candidateRecord[field] === null || candidateRecord[field] === undefined,
    );
    await this.draftRepository.create({
      id: draftId,
      userId: payload.userId,
      partialData: candidate,
      missingFields,
      originalText: inputText,
      sourceType: payload.sourceType,
    });

    const notification = await this.notificationRepository.create({
      userId: payload.userId,
      type: 'ReceiptOcrDraftReady',
      message: renderOcrDraftReviewMessage(candidate, extraction.output.detectedLanguage),
      dedupKey: draftId,
      readyToDeliverAt: new Date(),
      replyMarkup: buildOcrDraftReviewKeyboard(draftId, extraction.output.detectedLanguage),
    });
    await this.deliveryQueue.enqueue(notification.id, payload.userId, new Date());

    return { status: 'extracted', ocrResult, extraction, draftId };
  }

  private async notifyFailure(
    payload: OcrExtractionJobPayload,
    renderMessage: (language: DetectedLanguage) => string,
  ): Promise<void> {
    // Best-effort, honest failure signal (AI-P6) — a plain-text notification,
    // no keyboard, no draft. Language defaults to 'en' here: this failure
    // path has no successful extraction to read a detected language from
    // (unlike the success path, which uses the real `detectedLanguage`).
    const notification = await this.notificationRepository.create({
      userId: payload.userId,
      type: 'ReceiptOcrFailed',
      message: renderMessage('en'),
      dedupKey: `ocr-failed:${payload.telegramFileId}`,
      readyToDeliverAt: new Date(),
    });
    await this.deliveryQueue.enqueue(notification.id, payload.userId, new Date());
  }
}
