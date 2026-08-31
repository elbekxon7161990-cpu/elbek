import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import type {
  ObjectStoragePort,
  OcrExtractionJobPayload,
  OcrExtractionQueuePort,
} from '@afa/domain';
import { ObjectStorageUnavailableError } from '@afa/domain';

import { RoutePhotoMessageUseCase } from './route-photo-message.use-case';

class LocalFakeObjectStorage implements ObjectStoragePort {
  readonly puts: { uri: string; data: Buffer; contentType: string }[] = [];
  private shouldFail = false;
  failNext(): void {
    this.shouldFail = true;
  }
  async getObject(): Promise<Buffer> {
    throw new Error('not used in this test');
  }
  async putObject(uri: string, data: Buffer, contentType: string): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new ObjectStorageUnavailableError();
    }
    this.puts.push({ uri, data, contentType });
  }
  async deleteObject(): Promise<void> {
    throw new Error('not used in this test');
  }
  async deleteObjectsByPrefix(): Promise<void> {
    throw new Error('not used in this test');
  }
}

class LocalFakeOcrQueue implements OcrExtractionQueuePort {
  readonly enqueued: OcrExtractionJobPayload[] = [];
  async enqueue(payload: OcrExtractionJobPayload): Promise<void> {
    this.enqueued.push(payload);
  }
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    telegramFileId: 'file-1',
    image: Buffer.from('fake-jpeg-bytes'),
    mimeType: 'image/jpeg',
    sizeBytes: 15,
    sourceType: 'photo' as const,
    caption: null,
    currentDateTime: '2026-08-14T10:00:00+05:00',
    userDefaultCurrency: 'UZS',
    userRecentCategories: [],
    ...overrides,
  };
}

describe('RoutePhotoMessageUseCase', () => {
  it('rejects invalid images before touching storage or the queue', async () => {
    const storage = new LocalFakeObjectStorage();
    const queue = new LocalFakeOcrQueue();
    const useCase = new RoutePhotoMessageUseCase(storage, queue);

    const outcome = await useCase.execute(input({ mimeType: 'image/gif' }));

    expect(outcome).toEqual({ kind: 'invalid_image', reason: 'UNSUPPORTED_FORMAT' });
    expect(queue.enqueued).toHaveLength(0);
  });

  it('uploads then enqueues a valid photo, carrying the caption through unchanged (§19.2.2 caption-precedence row)', async () => {
    const storage = new LocalFakeObjectStorage();
    const queue = new LocalFakeOcrQueue();
    const useCase = new RoutePhotoMessageUseCase(storage, queue);

    const outcome = await useCase.execute(input({ caption: 'dinner with friends' }));

    expect(outcome).toEqual({ kind: 'enqueued', jobId: 'ocr-file-1' });
    expect(queue.enqueued[0]?.caption).toBe('dinner with friends');
    expect(queue.enqueued[0]?.sourceType).toBe('photo');
  });

  it('reports storage_failure without enqueuing when the upload fails', async () => {
    const storage = new LocalFakeObjectStorage();
    storage.failNext();
    const queue = new LocalFakeOcrQueue();
    const useCase = new RoutePhotoMessageUseCase(storage, queue);

    const outcome = await useCase.execute(input());

    expect(outcome).toEqual({ kind: 'storage_failure' });
    expect(queue.enqueued).toHaveLength(0);
  });
});
