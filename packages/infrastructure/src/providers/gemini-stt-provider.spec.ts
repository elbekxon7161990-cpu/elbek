import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, GoogleGenAI } from '@google/genai';
import {
  SttProviderAuthenticationError,
  SttProviderInvalidAudioError,
  SttProviderMalformedResponseError,
  SttProviderRateLimitError,
  SttProviderUnavailableError,
} from '@afa/domain';

import { GeminiSttProvider } from './gemini-stt-provider';

function fakeClient(generateContentImpl: (...args: unknown[]) => unknown): GoogleGenAI {
  return { models: { generateContent: vi.fn(generateContentImpl) } } as unknown as GoogleGenAI;
}

function providerWithClient(client: GoogleGenAI): GeminiSttProvider {
  const provider = new GeminiSttProvider('unused-in-tests', 'gemini-2.5-flash', 60_000);
  (provider as unknown as { client: GoogleGenAI }).client = client;
  return provider;
}

const VALID_REQUEST = {
  audio: Buffer.from([0x4f, 0x67, 0x67, 0x53]),
  mimeType: 'audio/ogg',
};

describe('GeminiSttProvider', () => {
  it('transcribes, parsing the structured JSON response into a SttTranscriptionResult', async () => {
    const client = fakeClient(() =>
      Promise.resolve({
        text: JSON.stringify({
          transcript: "Bugun ovqatga 50 ming so'm sarfladim",
          detectedLanguage: 'uz',
          confidence: 0.92,
          durationSeconds: 4.2,
        }),
      }),
    );
    const provider = providerWithClient(client);

    const result = await provider.transcribe(VALID_REQUEST);

    expect(result.transcript).toBe("Bugun ovqatga 50 ming so'm sarfladim");
    expect(result.detectedLanguage).toBe('uz');
    expect(result.confidence).toBe(0.92);
    expect(result.durationSeconds).toBe(4.2);
    expect(result.providerModelIdentifier).toBe('gemini-2.5-flash');

    const callArgs = (client.models.generateContent as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as {
      model: string;
      config: { responseMimeType: string };
    };
    expect(callArgs.model).toBe('gemini-2.5-flash');
    expect(callArgs.config.responseMimeType).toBe('application/json');
  });

  it('defaults detectedLanguage to null when the model omits it', async () => {
    const client = fakeClient(() =>
      Promise.resolve({
        text: JSON.stringify({ transcript: 'hello', confidence: 0.5, durationSeconds: 1 }),
      }),
    );
    const provider = providerWithClient(client);

    const result = await provider.transcribe(VALID_REQUEST);
    expect(result.detectedLanguage).toBeNull();
  });

  it('throws SttProviderMalformedResponseError when the response has no text', async () => {
    const client = fakeClient(() => Promise.resolve({ text: undefined }));
    const provider = providerWithClient(client);

    await expect(provider.transcribe(VALID_REQUEST)).rejects.toBeInstanceOf(
      SttProviderMalformedResponseError,
    );
  });

  it('throws SttProviderMalformedResponseError when the response text is not valid JSON', async () => {
    const client = fakeClient(() => Promise.resolve({ text: 'not json' }));
    const provider = providerWithClient(client);

    await expect(provider.transcribe(VALID_REQUEST)).rejects.toBeInstanceOf(
      SttProviderMalformedResponseError,
    );
  });

  it('throws SttProviderMalformedResponseError when required fields are missing from the parsed JSON', async () => {
    const client = fakeClient(() =>
      Promise.resolve({ text: JSON.stringify({ transcript: 'hi' }) }),
    );
    const provider = providerWithClient(client);

    await expect(provider.transcribe(VALID_REQUEST)).rejects.toBeInstanceOf(
      SttProviderMalformedResponseError,
    );
  });

  it('maps a 401 ApiError to SttProviderAuthenticationError', async () => {
    const client = fakeClient(() =>
      Promise.reject(new ApiError({ message: 'unauthorized', status: 401 })),
    );
    const provider = providerWithClient(client);

    await expect(provider.transcribe(VALID_REQUEST)).rejects.toBeInstanceOf(
      SttProviderAuthenticationError,
    );
  });

  it('maps a 429 ApiError to SttProviderRateLimitError', async () => {
    const client = fakeClient(() =>
      Promise.reject(new ApiError({ message: 'rate limited', status: 429 })),
    );
    const provider = providerWithClient(client);

    await expect(provider.transcribe(VALID_REQUEST)).rejects.toBeInstanceOf(
      SttProviderRateLimitError,
    );
  });

  it('maps a 400 ApiError to SttProviderInvalidAudioError', async () => {
    const client = fakeClient(() =>
      Promise.reject(new ApiError({ message: 'bad request', status: 400 })),
    );
    const provider = providerWithClient(client);

    await expect(provider.transcribe(VALID_REQUEST)).rejects.toBeInstanceOf(
      SttProviderInvalidAudioError,
    );
  });

  it('maps an unexpected SDK error to SttProviderUnavailableError, never leaking the raw error', async () => {
    const client = fakeClient(() => Promise.reject(new Error('connect ECONNREFUSED 1.2.3.4:443')));
    const provider = providerWithClient(client);

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
    const client = fakeClient(() =>
      Promise.reject(new Error('Invalid API key: AIzaSySECRET12345')),
    );
    const provider = providerWithClient(client);

    let message = '';
    try {
      await provider.transcribe(VALID_REQUEST);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('AIzaSy');
    expect(message).not.toContain('SECRET12345');
  });
});
