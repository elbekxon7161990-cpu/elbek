import type { Buffer } from 'node:buffer';
import { Inject, Injectable } from '@nestjs/common';
import type {
  ImageValidationFailureReason,
  ObjectStoragePort,
  OcrExtractionQueuePort,
} from '@afa/domain';
import {
  OBJECT_STORAGE,
  OCR_EXTRACTION_QUEUE,
  ObjectStorageError,
  evaluateImageValidity,
} from '@afa/domain';

export interface RoutePhotoMessageInput {
  userId: string;
  telegramFileId: string;
  image: Buffer;
  mimeType: string;
  sizeBytes: number;
  /** Distinguishes a photographed receipt from a screenshot upload (BR-INP-003) — supplied by the caller, this use case never infers it. */
  sourceType: 'photo' | 'screenshot';
  /** §19.2.2's "Photo with caption text" row — caption text takes precedence over OCR for any field it clearly states; carried through unchanged for `ProcessReceiptImageUseCase` (TASK-AI-006) to apply. */
  caption: string | null;
  currentDateTime: string;
  userDefaultCurrency: string;
  userRecentCategories: readonly string[];
}

export interface RoutePhotoInvalidImageOutcome {
  kind: 'invalid_image';
  reason: ImageValidationFailureReason;
}

export interface RoutePhotoStorageFailureOutcome {
  kind: 'storage_failure';
}

export interface PhotoEnqueuedOutcome {
  kind: 'enqueued';
  jobId: string;
}

export type RoutePhotoMessageOutcome =
  RoutePhotoInvalidImageOutcome | RoutePhotoStorageFailureOutcome | PhotoEnqueuedOutcome;

/**
 * TASK-BOT-001 (Chapter 19 §19.2.2's photo rows; §6.13.2's sequence
 * diagram — upload raw image to Object Storage, THEN enqueue). Mirrors
 * `RouteVoiceMessageUseCase` exactly; does not reimplement any part of
 * TASK-AI-006's OCR pipeline — this use case's only job is producing a
 * valid `OcrExtractionJobPayload` and getting it onto the `ocr-extraction`
 * queue.
 */
@Injectable()
export class RoutePhotoMessageUseCase {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStoragePort,
    @Inject(OCR_EXTRACTION_QUEUE) private readonly queue: OcrExtractionQueuePort,
  ) {}

  async execute(input: RoutePhotoMessageInput): Promise<RoutePhotoMessageOutcome> {
    const validation = evaluateImageValidity({
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });
    if (!validation.valid) {
      return { kind: 'invalid_image', reason: validation.reason };
    }

    const extension = input.mimeType === 'image/png' ? 'png' : 'jpg';
    const uri = `photo/${input.userId}/${input.telegramFileId}.${extension}`;
    try {
      await this.objectStorage.putObject(uri, input.image, input.mimeType);
    } catch (error) {
      if (error instanceof ObjectStorageError) {
        return { kind: 'storage_failure' };
      }
      throw error;
    }

    const jobId = `ocr-${input.telegramFileId}`;
    await this.queue.enqueue({
      jobId,
      userId: input.userId,
      telegramFileId: input.telegramFileId,
      imageObjectStorageUri: uri,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sourceType: input.sourceType,
      caption: input.caption,
      currentDateTime: input.currentDateTime,
      userDefaultCurrency: input.userDefaultCurrency,
      userRecentCategories: input.userRecentCategories,
    });

    return { kind: 'enqueued', jobId };
  }
}
