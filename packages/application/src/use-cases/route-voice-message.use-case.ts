import type { Buffer } from 'node:buffer';
import { Inject, Injectable } from '@nestjs/common';
import type {
  AudioValidationFailureReason,
  ObjectStoragePort,
  VoiceTranscriptionQueuePort,
} from '@afa/domain';
import {
  OBJECT_STORAGE,
  ObjectStorageError,
  VOICE_TRANSCRIPTION_QUEUE,
  evaluateAudioValidity,
} from '@afa/domain';

export interface RouteVoiceMessageInput {
  userId: string;
  telegramFileId: string;
  audio: Buffer;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
  currentDateTime: string;
  userDefaultCurrency: string;
  userRecentCategories: readonly string[];
}

export interface RouteVoiceInvalidAudioOutcome {
  kind: 'invalid_audio';
  reason: AudioValidationFailureReason;
}

export interface RouteVoiceStorageFailureOutcome {
  kind: 'storage_failure';
}

export interface VoiceEnqueuedOutcome {
  kind: 'enqueued';
  jobId: string;
}

export type RouteVoiceMessageOutcome =
  RouteVoiceInvalidAudioOutcome | RouteVoiceStorageFailureOutcome | VoiceEnqueuedOutcome;

/**
 * TASK-BOT-001 (Chapter 19 §19.2.2's "Voice message -> STT Worker -> AI
 * Processing Core | Async, ack < 1s" row; §6.12.2's sequence diagram —
 * upload raw audio to Object Storage, THEN enqueue). Does not reimplement
 * TASK-AI-005's transcription pipeline at all — this use case's only job is
 * producing a valid `VoiceTranscriptionJobPayload` and getting it onto the
 * `stt-transcription` queue; everything past that point is
 * `TranscribeVoiceMessageUseCase`'s (TASK-AI-005) territory.
 *
 * `jobId` is derived from `telegramFileId` (per `VoiceTranscriptionJobPayload`'s
 * own doc comment) so BullMQ's own duplicate-jobId-is-a-no-op behavior makes
 * re-enqueueing on a redelivered Telegram update idempotent without any
 * extra dedup logic here.
 */
@Injectable()
export class RouteVoiceMessageUseCase {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStoragePort,
    @Inject(VOICE_TRANSCRIPTION_QUEUE) private readonly queue: VoiceTranscriptionQueuePort,
  ) {}

  async execute(input: RouteVoiceMessageInput): Promise<RouteVoiceMessageOutcome> {
    const validation = evaluateAudioValidity({
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      durationSeconds: input.durationSeconds,
    });
    if (!validation.valid) {
      return { kind: 'invalid_audio', reason: validation.reason };
    }

    const uri = `voice/${input.userId}/${input.telegramFileId}.ogg`;
    try {
      await this.objectStorage.putObject(uri, input.audio, input.mimeType);
    } catch (error) {
      if (error instanceof ObjectStorageError) {
        return { kind: 'storage_failure' };
      }
      throw error;
    }

    const jobId = `stt-${input.telegramFileId}`;
    await this.queue.enqueue({
      jobId,
      userId: input.userId,
      telegramFileId: input.telegramFileId,
      audioObjectStorageUri: uri,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      durationSeconds: input.durationSeconds,
      currentDateTime: input.currentDateTime,
      userDefaultCurrency: input.userDefaultCurrency,
      userRecentCategories: input.userRecentCategories,
    });

    return { kind: 'enqueued', jobId };
  }
}
