import { describe, expect, it, vi } from 'vitest';
import type { OcrExtractionJobPayload } from '@afa/domain';
import type { Queue } from 'bullmq';

import { BullMqOcrExtractionQueue } from './bullmq-ocr-extraction-queue.repository';
import { OCR_EXTRACTION_QUEUE_NAME } from './ocr-extraction.queue.module';

function payload(): OcrExtractionJobPayload {
  return {
    jobId: 'ocr-file-1',
    userId: 'user-1',
    telegramFileId: 'file-1',
    imageObjectStorageUri: 'photo/user-1/file-1.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 100,
    sourceType: 'photo',
    caption: null,
    currentDateTime: '2026-08-14T10:00:00+05:00',
    userDefaultCurrency: 'UZS',
    userRecentCategories: [],
  };
}

describe('BullMqOcrExtractionQueue', () => {
  it('enqueues onto the ocr-extraction queue with the payload jobId as the BullMQ jobId', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const queue = { add } as unknown as Queue<OcrExtractionJobPayload>;
    const producer = new BullMqOcrExtractionQueue(queue);

    await producer.enqueue(payload());

    expect(add).toHaveBeenCalledWith(OCR_EXTRACTION_QUEUE_NAME, payload(), { jobId: 'ocr-file-1' });
  });
});
