import { describe, expect, it, vi } from 'vitest';
import type { VoiceTranscriptionJobPayload } from '@afa/domain';
import type { Queue } from 'bullmq';

import { BullMqVoiceTranscriptionQueue } from './bullmq-voice-transcription-queue.repository';
import { STT_TRANSCRIPTION_QUEUE_NAME } from './stt-transcription.queue.module';

function payload(): VoiceTranscriptionJobPayload {
  return {
    jobId: 'stt-file-1',
    userId: 'user-1',
    telegramFileId: 'file-1',
    audioObjectStorageUri: 'voice/user-1/file-1.ogg',
    mimeType: 'audio/ogg',
    sizeBytes: 100,
    durationSeconds: 5,
    currentDateTime: '2026-08-14T10:00:00+05:00',
    userDefaultCurrency: 'UZS',
    userRecentCategories: [],
  };
}

describe('BullMqVoiceTranscriptionQueue', () => {
  it('enqueues onto the stt-transcription queue with the payload jobId as the BullMQ jobId', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const queue = { add } as unknown as Queue<VoiceTranscriptionJobPayload>;
    const producer = new BullMqVoiceTranscriptionQueue(queue);

    await producer.enqueue(payload());

    expect(add).toHaveBeenCalledWith(STT_TRANSCRIPTION_QUEUE_NAME, payload(), {
      jobId: 'stt-file-1',
    });
  });
});
