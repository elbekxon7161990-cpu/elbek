import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { ProcessReceiptImageUseCase, ProcessReceiptImageOutcome } from '@afa/application';
import type { OcrExtractionJobPayload } from '@afa/domain';

import { OcrExtractionProcessor } from './ocr-extraction.processor';

function payload(overrides: Partial<OcrExtractionJobPayload> = {}): OcrExtractionJobPayload {
  return {
    jobId: 'job-1',
    userId: 'user-1',
    telegramFileId: 'AgACAgIA...',
    imageObjectStorageUri: 's3://bucket/receipts/1.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 500_000,
    sourceType: 'photo',
    caption: null,
    currentDateTime: '2026-08-14T10:00:00+05:00',
    userDefaultCurrency: 'UZS',
    userRecentCategories: [],
    ...overrides,
  };
}

function fakeJob(data: OcrExtractionJobPayload): Job<OcrExtractionJobPayload> {
  return { id: 'bullmq-job-1', data } as unknown as Job<OcrExtractionJobPayload>;
}

function fakeUseCase(outcome: ProcessReceiptImageOutcome): ProcessReceiptImageUseCase {
  return { execute: vi.fn().mockResolvedValue(outcome) } as unknown as ProcessReceiptImageUseCase;
}

describe('OcrExtractionProcessor', () => {
  it('dispatches the job payload to ProcessReceiptImageUseCase and returns its status', async () => {
    const useCase = fakeUseCase({ status: 'ocr_failed', reason: 'timeout' });
    const processor = new OcrExtractionProcessor(useCase);

    const result = await processor.process(fakeJob(payload()));

    expect(useCase.execute).toHaveBeenCalledWith(payload());
    expect(result).toEqual({ status: 'ocr_failed' });
  });

  it('refuses to process a job with no userId (basic authorization guard), never calling the use case', async () => {
    const useCase = fakeUseCase({ status: 'ocr_failed', reason: 'n/a' });
    const processor = new OcrExtractionProcessor(useCase);

    await expect(processor.process(fakeJob(payload({ userId: '' })))).rejects.toThrow(/userId/);
    expect(useCase.execute).not.toHaveBeenCalled();
  });

  it('propagates an unexpected error from the use case (letting BullMQ apply its own retry policy)', async () => {
    const useCase: ProcessReceiptImageUseCase = {
      execute: vi.fn().mockRejectedValue(new Error('unexpected infra fault')),
    } as unknown as ProcessReceiptImageUseCase;
    const processor = new OcrExtractionProcessor(useCase);

    await expect(processor.process(fakeJob(payload()))).rejects.toThrow('unexpected infra fault');
  });

  it('returns only a status-shaped result — never the OCR-text/image-bearing outcome object wholesale', async () => {
    const useCase = fakeUseCase({
      status: 'extracted',
      ocrResult: { rawText: 'sensitive financial detail' } as never,
      extraction: { status: 'unknown', reason: 'n/a' },
      draftId: 'draft-1',
    });
    const processor = new OcrExtractionProcessor(useCase);

    const result = await processor.process(fakeJob(payload()));

    expect(result).toEqual({ status: 'extracted' });
    expect(JSON.stringify(result)).not.toContain('sensitive');
  });
});
