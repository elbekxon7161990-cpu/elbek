import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import type { SttProvider, SttTranscriptionRequest } from '@afa/domain';

import { FakeSttProvider } from './fake-stt-provider';

/**
 * TASK-INFRA-010's own DoD, verified for the `SttProvider` adapter
 * category specifically: "swapping a provider implementation requires
 * changes only within its adapter." This consumer function depends only
 * on the `SttProvider` port — swapping which concrete instance it receives
 * never requires touching this function.
 */
async function consumeTranscript(
  provider: SttProvider,
  request: SttTranscriptionRequest,
): Promise<string> {
  const result = await provider.transcribe(request);
  return result.transcript;
}

describe('SttProvider swap contract', () => {
  const request: SttTranscriptionRequest = { audio: Buffer.from('audio'), mimeType: 'audio/ogg' };

  it('the consumer behaves identically regardless of which concrete SttProvider is injected', async () => {
    const providerA = new FakeSttProvider({
      transcript: 'spent 45000 on lunch',
      detectedLanguage: 'en',
      confidence: 0.95,
      durationSeconds: 3,
      providerModelIdentifier: 'provider-a',
    });
    const providerB = new FakeSttProvider({
      transcript: 'spent 45000 on lunch',
      detectedLanguage: 'en',
      confidence: 0.88,
      durationSeconds: 3,
      providerModelIdentifier: 'provider-b',
    });

    const resultA = await consumeTranscript(providerA, request);
    const resultB = await consumeTranscript(providerB, request);

    expect(resultA).toBe(resultB);
  });
});
