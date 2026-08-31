import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  SttProviderAuthenticationError,
  SttProviderInvalidAudioError,
  SttProviderTimeoutError,
} from '@afa/domain';
import type { SttTranscriptionRequest, SttTranscriptionResult } from '@afa/domain';

import { FakeSttProvider } from './fake-stt-provider';
import { RetryingSttProvider } from './retrying-stt-provider';

const REQUEST: SttTranscriptionRequest = {
  audio: Buffer.from('fake-audio'),
  mimeType: 'audio/ogg',
};

function result(overrides: Partial<SttTranscriptionResult> = {}): SttTranscriptionResult {
  return {
    transcript: 'spent 45000 on lunch',
    detectedLanguage: 'en',
    confidence: 0.95,
    durationSeconds: 3,
    providerModelIdentifier: 'fake-stt-model',
    ...overrides,
  };
}

describe('RetryingSttProvider', () => {
  it('returns the result immediately on first-attempt success, no retry', async () => {
    const fake = new FakeSttProvider(result());
    const provider = new RetryingSttProvider(fake, { maxAttempts: 2, backoffMs: 1 });

    await provider.transcribe(REQUEST);

    expect(fake.callCount).toBe(1);
  });

  it('retries once on a transient timeout, then succeeds', async () => {
    const fake = new FakeSttProvider(result());
    fake.enqueue({ error: new SttProviderTimeoutError('fake', 5000) });
    const provider = new RetryingSttProvider(fake, { maxAttempts: 2, backoffMs: 1 });

    const outcome = await provider.transcribe(REQUEST);

    expect(fake.callCount).toBe(2);
    expect(outcome.transcript).toBe('spent 45000 on lunch');
  });

  it('exhausts retries and throws the last error', async () => {
    const fake = new FakeSttProvider(result());
    fake.enqueue({ error: new SttProviderTimeoutError('fake', 5000) });
    fake.enqueue({ error: new SttProviderTimeoutError('fake', 5000) });
    const provider = new RetryingSttProvider(fake, { maxAttempts: 2, backoffMs: 1 });

    await expect(provider.transcribe(REQUEST)).rejects.toBeInstanceOf(SttProviderTimeoutError);
    expect(fake.callCount).toBe(2);
  });

  it('never retries an authentication error', async () => {
    const fake = new FakeSttProvider(result());
    fake.enqueue({ error: new SttProviderAuthenticationError('fake') });
    const provider = new RetryingSttProvider(fake, { maxAttempts: 3, backoffMs: 1 });

    await expect(provider.transcribe(REQUEST)).rejects.toBeInstanceOf(
      SttProviderAuthenticationError,
    );
    expect(fake.callCount).toBe(1);
  });

  it('never retries an invalid-audio error (corrupted/rejected audio, same bytes would fail identically)', async () => {
    const fake = new FakeSttProvider(result());
    fake.enqueue({ error: new SttProviderInvalidAudioError('fake', 'corrupted') });
    const provider = new RetryingSttProvider(fake, { maxAttempts: 3, backoffMs: 1 });

    await expect(provider.transcribe(REQUEST)).rejects.toBeInstanceOf(SttProviderInvalidAudioError);
    expect(fake.callCount).toBe(1);
  });

  it('applies backoff between retries', async () => {
    const fake = new FakeSttProvider(result());
    fake.enqueue({ error: new SttProviderTimeoutError('fake', 5000) });
    const delayFn = vi.fn().mockResolvedValue(undefined);
    const provider = new RetryingSttProvider(fake, { maxAttempts: 2, backoffMs: 250 }, delayFn);

    await provider.transcribe(REQUEST);

    expect(delayFn).toHaveBeenCalledWith(250);
  });
});
