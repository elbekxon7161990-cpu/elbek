import { Inject, Injectable } from '@nestjs/common';
import type { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type {
  AudioValidationFailureReason,
  DetectedLanguage,
  DraftRepository,
  NotificationDeliveryQueue,
  NotificationRepository,
  ObjectStoragePort,
  SttProvider,
  StructuredTranscriptionResult,
  VoiceTranscriptionJobPayload,
} from '@afa/domain';
import {
  DRAFT_REPOSITORY,
  NOTIFICATION_DELIVERY_QUEUE,
  NOTIFICATION_REPOSITORY,
  OBJECT_STORAGE,
  ObjectStorageError,
  STT_PROVIDER,
  SttProviderError,
  buildOcrDraftReviewKeyboard,
  computeRequiredFields,
  evaluateAudioValidity,
  normalizeTranscript,
  renderVoiceDraftReviewMessage,
  renderVoiceExtractionFailedMessage,
  renderVoiceNoTransactionDetectedMessage,
  transcriptRequiresConfirmation,
} from '@afa/domain';

import { ExtractTransactionCandidatesUseCase } from './extract-transaction-candidates.use-case';
import type { ExtractionOutcome } from './extract-transaction-candidates.use-case';

export interface InvalidAudioOutcome {
  status: 'invalid_audio';
  reason: AudioValidationFailureReason;
}

export interface StorageFailureOutcome {
  status: 'storage_failure';
  reason: string;
}

/** FR-STT-007 — "the bot must inform the user and invite them to type instead — never fail silently." */
export interface SttFailedOutcome {
  status: 'stt_failed';
  reason: string;
}

/** FR-STT-005 — extraction is deliberately NOT run; the transcript is held pending the user's confirmation. */
export interface ConfirmationRequiredOutcome {
  status: 'confirmation_required';
  transcription: StructuredTranscriptionResult;
}

/** The audio transcribed fine but no transaction-shaped content was found in it. */
export interface VoiceNoTransactionDetectedOutcome {
  status: 'no_transaction_detected';
}

/**
 * A draft already exists for this exact `telegramFileId` — a BullMQ
 * redelivery of the same job (at-least-once delivery) safely no-ops rather
 * than creating a second draft and sending a second Telegram review card.
 * Mirrors `ProcessReceiptImageUseCase`'s own `AlreadyProcessedOutcome`
 * (renamed with a `Voice` prefix here only to avoid the two use cases'
 * wildcard re-exports from `@afa/application`'s `index.ts` colliding).
 */
export interface VoiceAlreadyProcessedOutcome {
  status: 'already_processed';
  draftId: string;
}

/** AC-INP-001 — high confidence, no confirmation prompt, straight into the existing extraction pipeline; a review draft was created and the user notified with a Confirm/Edit/Cancel card. */
export interface TranscribedOutcome {
  status: 'transcribed';
  transcription: StructuredTranscriptionResult;
  extraction: ExtractionOutcome;
  draftId: string;
}

export type TranscribeVoiceMessageOutcome =
  | InvalidAudioOutcome
  | StorageFailureOutcome
  | SttFailedOutcome
  | ConfirmationRequiredOutcome
  | VoiceNoTransactionDetectedOutcome
  | VoiceAlreadyProcessedOutcome
  | TranscribedOutcome;

/** Mirrors `ProcessReceiptImageUseCase`'s own `deterministicDraftId` exactly, salted differently so a voice and a photo message that somehow shared a `telegramFileId` (impossible in practice — Telegram's file ids are already namespaced per message) could never collide. */
function deterministicDraftId(telegramFileId: string): string {
  const hex = createHash('sha256')
    .update(`voice-draft:${telegramFileId}`)
    .digest('hex')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * TASK-AI-005 (Chapter 6 §6.2/§6.12) — the Audio Preprocessor + STT
 * Provider + confidence-signal-separation steps from §6.12.2's sequence
 * diagram, composed as one use case. By the time this executes, the raw
 * audio has already been uploaded to Object Storage and this job enqueued
 * by the Bot Application Layer (a different, not-yet-built task) — this
 * use case starts from `VoiceTranscriptionJobPayload`, never talks to
 * Telegram directly, and never writes to Prisma or sends a Telegram
 * message itself (persistence and user-facing messaging both remain
 * downstream, out of this task's scope — same boundary TASK-AI-002/003/004
 * already established for their own layers).
 *
 * FR-STT-004: on the non-low-confidence path, the transcript becomes
 * `ExtractionContext.inputText` and is handed to
 * `ExtractTransactionCandidatesUseCase` (TASK-AI-002, reused unchanged —
 * no separate voice-specific extraction logic is implemented here).
 *
 * Deliberately diverges from `ExtractTransactionCandidatesUseCase`'s own
 * choice to let `LlmProviderError` propagate uncaught: FR-STT-007
 * specifically requires a graceful, catchable "STT failed entirely"
 * outcome so a caller can show the "invite to type instead" message — an
 * uncaught exception here would leave that requirement unmet. Errors are
 * only caught here *after* the injected `SttProvider` (expected to already
 * be composed with `RetryingSttProvider`/`CircuitBreakerSttProvider`/
 * `FallbackSttProvider`, mirroring TASK-INFRA-010's resilience wrapping)
 * has exhausted its own retry/fallback — this use case does not duplicate
 * that resilience logic, it only converts a final, exhausted failure into
 * the specific outcome FR-STT-007 requires.
 *
 * Completion round (mirrors `ProcessReceiptImageUseCase`'s own TASK-AI-006
 * completion round exactly): a successful, high-confidence transcription
 * now genuinely produces a `TransactionDraftRecord` (reusing
 * `DraftRepository` unchanged — the same port/table both the text and OCR
 * pathways already use) and an async Telegram review notification (reusing
 * `NotificationRepository`/`NotificationDeliveryQueue` directly, same
 * immediate-delivery reasoning as the OCR pathway: a user who just spoke a
 * voice message wants their review card right away, never delayed by
 * ambient-notification gating). Every non-`transcribed` outcome past the
 * pre-flight `invalid_audio` check ALSO now sends an honest, plain-text
 * failure notification (AI-P6, "never silent failure") — before this round,
 * a failed/low-value STT job produced no user-visible signal at all beyond
 * the bot's immediate "processing" ack.
 *
 * Still never talks to Telegram directly and never writes to Prisma's
 * `transactions` table itself — draft creation and notification are as far
 * as this use case's own boundary goes; the actual commit only happens once
 * the user taps Confirm (`RouteOcrDraftCallbackUseCase`, reused unchanged —
 * `ocrdraft_<action>:<draftId>` is already source-agnostic, see
 * `render-voice-draft-review-message.ts`'s own doc comment).
 *
 * The `confirmation_required` (low-confidence) path is deliberately left
 * exactly as before — no draft, no notification here — pending a separate,
 * not-yet-built text-reply confirmation flow (FR-STT-005's own scope); a
 * generic honest-failure notification would be actively wrong there since
 * the transcript is not a failure, just held pending clarification.
 */
@Injectable()
export class TranscribeVoiceMessageUseCase {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStoragePort,
    @Inject(STT_PROVIDER) private readonly sttProvider: SttProvider,
    @Inject(DRAFT_REPOSITORY) private readonly draftRepository: DraftRepository,
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepository: NotificationRepository,
    @Inject(NOTIFICATION_DELIVERY_QUEUE) private readonly deliveryQueue: NotificationDeliveryQueue,
    private readonly extractTransactionCandidatesUseCase: ExtractTransactionCandidatesUseCase,
  ) {}

  async execute(payload: VoiceTranscriptionJobPayload): Promise<TranscribeVoiceMessageOutcome> {
    const validation = evaluateAudioValidity({
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
      durationSeconds: payload.durationSeconds,
    });
    if (!validation.valid) {
      return { status: 'invalid_audio', reason: validation.reason };
    }

    const draftId = deterministicDraftId(payload.telegramFileId);
    const existingDraft = await this.draftRepository.findById(draftId);
    if (existingDraft !== null) {
      return { status: 'already_processed', draftId };
    }

    let audio: Buffer;
    try {
      audio = await this.objectStorage.getObject(payload.audioObjectStorageUri);
    } catch (error) {
      if (error instanceof ObjectStorageError) {
        await this.notifyFailure(payload, renderVoiceExtractionFailedMessage);
        return { status: 'storage_failure', reason: error.message };
      }
      throw error;
    }

    let sttConfidence: number;
    let rawTranscript: string;
    let detectedLanguage: StructuredTranscriptionResult['detectedLanguage'];
    let providerModelIdentifier: string;
    let sttDurationSeconds: number;
    try {
      const sttResult = await this.sttProvider.transcribe({ audio, mimeType: payload.mimeType });
      sttConfidence = sttResult.confidence;
      rawTranscript = sttResult.transcript;
      detectedLanguage = sttResult.detectedLanguage;
      providerModelIdentifier = sttResult.providerModelIdentifier;
      sttDurationSeconds = sttResult.durationSeconds;
    } catch (error) {
      if (error instanceof SttProviderError) {
        await this.notifyFailure(payload, renderVoiceExtractionFailedMessage);
        return { status: 'stt_failed', reason: error.message };
      }
      throw error;
    }

    const normalizedTranscript = normalizeTranscript(rawTranscript);
    if (normalizedTranscript.length === 0) {
      await this.notifyFailure(payload, renderVoiceExtractionFailedMessage);
      return { status: 'stt_failed', reason: 'Provider returned an empty transcript.' };
    }

    const requiresConfirmation = transcriptRequiresConfirmation(sttConfidence);
    const transcription: StructuredTranscriptionResult = {
      transcript: rawTranscript,
      normalizedTranscript,
      detectedLanguage,
      sttConfidence,
      requiresConfirmation,
      durationSeconds: sttDurationSeconds,
      providerModelIdentifier,
      audioObjectStorageUri: payload.audioObjectStorageUri,
      sourceType: 'voice',
      processedAt: new Date().toISOString(),
    };

    if (requiresConfirmation) {
      return { status: 'confirmation_required', transcription };
    }

    const extraction = await this.extractTransactionCandidatesUseCase.execute({
      currentDateTime: payload.currentDateTime,
      userDefaultCurrency: payload.userDefaultCurrency,
      userRecentCategories: payload.userRecentCategories,
      pendingClarificationContext: null,
      inputText: normalizedTranscript,
    });

    if (extraction.status !== 'valid') {
      await this.notifyFailure(payload, renderVoiceExtractionFailedMessage);
      return { status: 'stt_failed', reason: extraction.reason };
    }

    // Mirrors `ProcessReceiptImageUseCase`'s own single-transaction MVP
    // scope (FR-OCR-008-style) — a voice message yields at most one
    // candidate.
    const candidate = extraction.output.transactions[0];
    if (candidate === undefined) {
      await this.notifyFailure(payload, renderVoiceNoTransactionDetectedMessage);
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
      originalText: normalizedTranscript,
      sourceType: 'voice',
    });

    const notification = await this.notificationRepository.create({
      userId: payload.userId,
      type: 'VoiceDraftReady',
      message: renderVoiceDraftReviewMessage(candidate, extraction.output.detectedLanguage),
      dedupKey: draftId,
      readyToDeliverAt: new Date(),
      replyMarkup: buildOcrDraftReviewKeyboard(draftId, extraction.output.detectedLanguage),
    });
    await this.deliveryQueue.enqueue(notification.id, payload.userId, new Date());

    return { status: 'transcribed', transcription, extraction, draftId };
  }

  private async notifyFailure(
    payload: VoiceTranscriptionJobPayload,
    renderMessage: (language: DetectedLanguage) => string,
  ): Promise<void> {
    // Best-effort, honest failure signal (AI-P6) — a plain-text notification,
    // no keyboard, no draft. Language defaults to 'en' here: this failure
    // path has no successful transcription to read a detected language from
    // (unlike the success path, which uses the real `detectedLanguage`).
    const notification = await this.notificationRepository.create({
      userId: payload.userId,
      type: 'VoiceTranscriptionFailed',
      message: renderMessage('en'),
      dedupKey: `voice-failed:${payload.telegramFileId}`,
      readyToDeliverAt: new Date(),
    });
    await this.deliveryQueue.enqueue(notification.id, payload.userId, new Date());
  }
}
