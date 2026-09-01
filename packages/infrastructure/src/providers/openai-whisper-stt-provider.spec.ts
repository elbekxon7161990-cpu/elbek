import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import {
  SttProviderAuthenticationError,
  SttProviderMalformedResponseError,
  SttProviderUnavailableError,
} from '@afa/domain';

import { OpenAiWhisperSttProvider } from './openai-whisper-stt-provider';

function fakeClient(createImpl: (...args: unknown[]) => unknown): OpenAI {
  return { audio: { transcriptions: { create: vi.fn(createImpl) } } } as unknown as OpenAI;
}

const VALID_REQUEST = {
  audio: Buffer.from([0x4f, 0x67, 0x67, 0x53]),
  mimeType: 'audio/ogg',
};

describe('OpenAiWhisperSttProvider', () => {
  it('transcribes, mapping Whisper\'s language name and averaging per-segment avg_logprob into a confidence score', async () => {
    const create = vi.fn().mockResolvedValue({
      text: 'Bugun ovqatga 50 ming so\'m sarfladim',
      language: 'uzbek',
      duration: 4.2,
      segments: [{ avg_logprob: -0.2 }, { avg_logprob: -0.4 }],
    });
    const client = { audio: { transcriptions: { create } } } as unknown as OpenAI;
    const provider = new OpenAiWhisperSttProvider(client, 'whisper-1', 60_000);

    const result = await provider.transcribe(VALID_REQUEST);

    expect(result.transcript).toBe("Bugun ovqatga 50 ming so'm sarfladim");
    expect(result.detectedLanguage).toBe('uz');
    expect(result.durationSeconds).toBe(4.2);
    expect(result.providerModelIdentifier).toBe('whisper-1');
    expect(result.confidence).toBeCloseTo(Math.exp(-0.3), 5);

    const callArgs = create.mock.calls[0]![0] as { model: string; response_format: string };
    expect(callArgs.model).toBe('whisper-1');
    expect(callArgs.response_format).toBe('verbose_json');
  });

  it('maps an unrecognized Whisper language name to null rather than guessing', async () => {
    const client = fakeClient(() =>
      Promise.resolve({ text: 'hello', language: 'klingon', duration: 1, segments: [{ avg_logprob: -0.1 }] }),
    );
    const provider = new OpenAiWhisperSttProvider(client, 'whisper-1', 60_000);

    const result = await provider.transcribe(VALID_REQUEST);
    expect(result.detectedLanguage).toBeNull();
  });

  it('reports zero confidence when Whisper returns no segments (silence/no speech)', async () => {
    const client = fakeClient(() =>
      Promise.resolve({ text: '', language: 'english', duration: 2, segments: [] }),
    );
    const provider = new OpenAiWhisperSttProvider(client, 'whisper-1', 60_000);

    const result = await provider.transcribe(VALID_REQUEST);
    expect(result.confidence).toBe(0);
  });

  it('throws SttProviderMalformedResponseError when the response has no text field', async () => {
    const client = fakeClient(() => Promise.resolve({ language: 'english', duration: 1 }));
    const provider = new OpenAiWhisperSttProvider(client, 'whisper-1', 60_000);

    await expect(provider.transcribe(VALID_REQUEST)).rejects.toBeInstanceOf(
      SttProviderMalformedResponseError,
    );
  });

  it('maps OpenAI.AuthenticationError to SttProviderAuthenticationError', async () => {
    const authError = Object.create(OpenAI.AuthenticationError.prototype) as InstanceType<
      typeof OpenAI.AuthenticationError
    >;
    const client = fakeClient(() => Promise.reject(authError));
    const provider = new OpenAiWhisperSttProvider(client, 'whisper-1', 60_000);

    await expect(provider.transcribe(VALID_REQUEST)).rejects.toBeInstanceOf(
      SttProviderAuthenticationError,
    );
  });

  it('maps an unexpected SDK error to SttProviderUnavailableError, never leaking the raw error', async () => {
    const client = fakeClient(() => Promise.reject(new Error('connect ECONNREFUSED 1.2.3.4:443')));
    const provider = new OpenAiWhisperSttProvider(client, 'whisper-1', 60_000);

    let thrown: unknown;
    try {
      await provider.transcribe(VALID_REQUEST);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SttProviderUnavailableError);
    expect((thrown as Error).message).not.toContain('1.2.3.4');
  });

  it('the mapped error message never contains an API key or credential-shaped string', async () => {
    const client = fakeClient(() => Promise.reject(new Error('Invalid API key: sk-proj-SECRET12345')));
    const provider = new OpenAiWhisperSttProvider(client, 'whisper-1', 60_000);

    let message = '';
    try {
      await provider.transcribe(VALID_REQUEST);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('sk-proj');
    expect(message).not.toContain('SECRET12345');
  });
});
