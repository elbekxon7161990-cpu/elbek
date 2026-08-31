import { Inject, Injectable } from '@nestjs/common';
import type { Buffer } from 'node:buffer';
import type {
  AudioValidationFailureReason,
  ObjectStoragePort,
  SttProvider,
  StructuredTranscriptionResult,
  VoiceTranscriptionJobPayload,
} from '@afa/domain';
import {
  OBJECT_STORAGE,
  ObjectStorageError,
  STT_PROVIDER,
  SttProviderError,
  evaluateAudioValidity,
  normalizeTranscript,
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

/** AC-INP-001 — high confidence, no confirmation prompt, straight into the existing extraction pipeline. */
export interface TranscribedOutcome {
  status: 'transcribed';
  transcription: StructuredTranscriptionResult;
  extraction: ExtractionOutcome;
}

export type TranscribeVoiceMessageOutcome =
  | InvalidAudioOutcome
  | StorageFailureOutcome
  | SttFailedOutcome
  | ConfirmationRequiredOutcome
  | TranscribedOutcome;

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
 */
@Injectable()
export class TranscribeVoiceMessageUseCase {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStoragePort,
    @Inject(STT_PROVIDER) private readonly sttProvider: SttProvider,
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

    let audio: Buffer;
    try {
      audio = await this.objectStorage.getObject(payload.audioObjectStorageUri);
    } catch (error) {
      if (error instanceof ObjectStorageError) {
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
        return { status: 'stt_failed', reason: error.message };
      }
      throw error;
    }

    const normalizedTranscript = normalizeTranscript(rawTranscript);
    if (normalizedTranscript.length === 0) {
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

    return { status: 'transcribed', transcription, extraction };
  }
}
