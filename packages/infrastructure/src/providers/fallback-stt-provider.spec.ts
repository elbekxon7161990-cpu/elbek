import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { SttProviderAuthenticationError, SttProviderTimeoutError } from '@afa/domain';
import type { SttTranscriptionRequest, SttTranscriptionResult } from '@afa/domain';

import { FakeSttProvider } from './fake-stt-provider';
import { FallbackSttProvider } from './fallback-stt-provider';

const REQUEST: SttTranscriptionRequest = {
  audio: Buffer.from('fake-audio'),
  mimeType: 'audio/ogg',
};

function result(providerModelIdentifier: string): SttTranscriptionResult {
  return {
    transcript: 'spent 45000 on lunch',
    detectedLanguage: 'en',
    confidence: 0.95,
    durationSeconds: 3,
    providerModelIdentifier,
  };
}

describe('FallbackSttProvider', () => {
  it('uses the primary provider when it succeeds', async () => {
    const primary = new FakeSttProvider(result('primary'));
    const secondary = new FakeSttProvider(result('secondary'));
    const provider = new FallbackSttProvider(primary, secondary);

    const outcome = await provider.transcribe(REQUEST);

    expect(outcome.providerModelIdentifier).toBe('primary');
    expect(secondary.callCount).toBe(0);
  });

  it('falls back to the secondary provider when the primary fails', async () => {
    const primary = new FakeSttProvider(result('primary'));
    primary.enqueue({ error: new SttProviderTimeoutError('primary', 5000) });
    const secondary = new FakeSttProvider(result('secondary'));
    const provider = new FallbackSttProvider(primary, secondary);

    const outcome = await provider.transcribe(REQUEST);

    expect(outcome.providerModelIdentifier).toBe('secondary');
  });

  it('falls back even on an authentication error (a different provider has different credentials)', async () => {
    const primary = new FakeSttProvider(result('primary'));
    primary.enqueue({ error: new SttProviderAuthenticationError('primary') });
    const secondary = new FakeSttProvider(result('secondary'));
    const provider = new FallbackSttProvider(primary, secondary);

    const outcome = await provider.transcribe(REQUEST);

    expect(outcome.providerModelIdentifier).toBe('secondary');
  });

  it("propagates the secondary's error if both fail", async () => {
    const primary = new FakeSttProvider(result('primary'));
    primary.enqueue({ error: new SttProviderTimeoutError('primary', 5000) });
    const secondary = new FakeSttProvider(result('secondary'));
    secondary.enqueue({ error: new SttProviderTimeoutError('secondary', 5000) });
    const provider = new FallbackSttProvider(primary, secondary);

    await expect(provider.transcribe(REQUEST)).rejects.toBeInstanceOf(SttProviderTimeoutError);
  });
});
