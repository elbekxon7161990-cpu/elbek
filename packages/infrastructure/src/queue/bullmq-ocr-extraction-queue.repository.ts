import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { OcrExtractionJobPayload, OcrExtractionQueuePort } from '@afa/domain';

import { OCR_EXTRACTION_QUEUE_NAME } from './ocr-extraction.queue.module';

/** TASK-BOT-001's `OcrExtractionQueuePort` implementation, mirroring `BullMqVoiceTranscriptionQueue` exactly. */
@Injectable()
export class BullMqOcrExtractionQueue implements OcrExtractionQueuePort {
  constructor(
    @InjectQueue(OCR_EXTRACTION_QUEUE_NAME) private readonly queue: Queue<OcrExtractionJobPayload>,
  ) {}

  async enqueue(payload: OcrExtractionJobPayload): Promise<void> {
    await this.queue.add(OCR_EXTRACTION_QUEUE_NAME, payload, { jobId: payload.jobId });
  }
}
