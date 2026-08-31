import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type {
  TranscribeVoiceMessageUseCase,
  TranscribeVoiceMessageOutcome,
} from '@afa/application';
import type { VoiceTranscriptionJobPayload } from '@afa/domain';

import { SttTranscriptionProcessor } from './stt-transcription.processor';

function payload(
  overrides: Partial<VoiceTranscriptionJobPayload> = {},
): VoiceTranscriptionJobPayload {
  return {
    jobId: 'job-1',
    userId: 'user-1',
    telegramFileId: 'AwACAgIA...',
    audioObjectStorageUri: 's3://bucket/voice/1.ogg',
    mimeType: 'audio/ogg',
    sizeBytes: 50_000,
    durationSeconds: 5,
    currentDateTime: '2026-08-14T10:00:00+05:00',
    userDefaultCurrency: 'UZS',
    userRecentCategories: [],
    ...overrides,
  };
}

function fakeJob(data: VoiceTranscriptionJobPayload): Job<VoiceTranscriptionJobPayload> {
  return { id: 'bullmq-job-1', data } as unknown as Job<VoiceTranscriptionJobPayload>;
}

function fakeUseCase(outcome: TranscribeVoiceMessageOutcome): TranscribeVoiceMessageUseCase {
  return {
    execute: vi.fn().mockResolvedValue(outcome),
  } as unknown as TranscribeVoiceMessageUseCase;
}

describe('SttTranscriptionProcessor', () => {
  it('dispatches the job payload to TranscribeVoiceMessageUseCase and returns its status', async () => {
    const useCase = fakeUseCase({ status: 'stt_failed', reason: 'timeout' });
    const processor = new SttTranscriptionProcessor(useCase);

    const result = await processor.process(fakeJob(payload()));

    expect(useCase.execute).toHaveBeenCalledWith(payload());
    expect(result).toEqual({ status: 'stt_failed' });
  });

  it('refuses to process a job with no userId (basic authorization guard), never calling the use case', async () => {
    const useCase = fakeUseCase({ status: 'stt_failed', reason: 'n/a' });
    const processor = new SttTranscriptionProcessor(useCase);

    await expect(processor.process(fakeJob(payload({ userId: '' })))).rejects.toThrow(/userId/);
    expect(useCase.execute).not.toHaveBeenCalled();
  });

  it('propagates an unexpected error from the use case (letting BullMQ apply its own retry policy)', async () => {
    const useCase: TranscribeVoiceMessageUseCase = {
      execute: vi.fn().mockRejectedValue(new Error('unexpected infra fault')),
    } as unknown as TranscribeVoiceMessageUseCase;
    const processor = new SttTranscriptionProcessor(useCase);

    await expect(processor.process(fakeJob(payload()))).rejects.toThrow('unexpected infra fault');
  });

  it('returns only a status-shaped result — never the transcript/audio-bearing outcome object wholesale', async () => {
    const useCase = fakeUseCase({
      status: 'transcribed',
      transcription: { transcript: 'sensitive financial detail' } as never,
      extraction: { status: 'unknown', reason: 'n/a' },
    });
    const processor = new SttTranscriptionProcessor(useCase);

    const result = await processor.process(fakeJob(payload()));

    expect(result).toEqual({ status: 'transcribed' });
    expect(JSON.stringify(result)).not.toContain('sensitive');
  });
});
