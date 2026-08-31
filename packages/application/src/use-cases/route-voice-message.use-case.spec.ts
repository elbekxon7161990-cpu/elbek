import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import type {
  ObjectStoragePort,
  VoiceTranscriptionJobPayload,
  VoiceTranscriptionQueuePort,
} from '@afa/domain';
import { ObjectStorageUnavailableError } from '@afa/domain';

import { RouteVoiceMessageUseCase } from './route-voice-message.use-case';

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

class LocalFakeVoiceQueue implements VoiceTranscriptionQueuePort {
  readonly enqueued: VoiceTranscriptionJobPayload[] = [];
  async enqueue(payload: VoiceTranscriptionJobPayload): Promise<void> {
    this.enqueued.push(payload);
  }
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    telegramFileId: 'file-1',
    audio: Buffer.from('fake-ogg-bytes'),
    mimeType: 'audio/ogg',
    sizeBytes: 14,
    durationSeconds: 5,
    currentDateTime: '2026-08-14T10:00:00+05:00',
    userDefaultCurrency: 'UZS',
    userRecentCategories: [],
    ...overrides,
  };
}

describe('RouteVoiceMessageUseCase', () => {
  it('rejects invalid audio before ever touching storage or the queue', async () => {
    const storage = new LocalFakeObjectStorage();
    const queue = new LocalFakeVoiceQueue();
    const useCase = new RouteVoiceMessageUseCase(storage, queue);

    const outcome = await useCase.execute(input({ sizeBytes: 0 }));

    expect(outcome).toEqual({ kind: 'invalid_audio', reason: 'EMPTY_AUDIO' });
    expect(storage.puts).toHaveLength(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  it('uploads then enqueues a valid voice message with a deterministic jobId derived from the Telegram file id', async () => {
    const storage = new LocalFakeObjectStorage();
    const queue = new LocalFakeVoiceQueue();
    const useCase = new RouteVoiceMessageUseCase(storage, queue);

    const outcome = await useCase.execute(input());

    expect(outcome).toEqual({ kind: 'enqueued', jobId: 'stt-file-1' });
    expect(storage.puts).toHaveLength(1);
    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0]?.audioObjectStorageUri).toBe(storage.puts[0]?.uri);
    expect(queue.enqueued[0]?.jobId).toBe('stt-file-1');
  });

  it('reports storage_failure when the object storage upload throws, without enqueuing', async () => {
    const storage = new LocalFakeObjectStorage();
    storage.failNext();
    const queue = new LocalFakeVoiceQueue();
    const useCase = new RouteVoiceMessageUseCase(storage, queue);

    const outcome = await useCase.execute(input());

    expect(outcome).toEqual({ kind: 'storage_failure' });
    expect(queue.enqueued).toHaveLength(0);
  });

  it('re-enqueuing the same telegramFileId (webhook redelivery) produces the same jobId — BullMQ dedup does the rest', async () => {
    const storage = new LocalFakeObjectStorage();
    const queue = new LocalFakeVoiceQueue();
    const useCase = new RouteVoiceMessageUseCase(storage, queue);

    const first = await useCase.execute(input());
    const second = await useCase.execute(input());

    expect(first).toEqual(second);
  });
});
