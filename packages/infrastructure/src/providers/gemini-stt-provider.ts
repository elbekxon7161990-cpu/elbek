import { ApiError, GoogleGenAI } from '@google/genai';
import {
  SttProviderAuthenticationError,
  SttProviderInvalidAudioError,
  SttProviderMalformedResponseError,
  SttProviderRateLimitError,
  SttProviderUnavailableError,
} from '@afa/domain';
import type {
  DetectedLanguage,
  SttProvider,
  SttTranscriptionRequest,
  SttTranscriptionResult,
} from '@afa/domain';

const PROVIDER_NAME = 'gemini';

const STRUCTURED_STT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['transcript', 'detectedLanguage', 'confidence', 'durationSeconds'],
  properties: {
    transcript: {
      type: 'string',
      description:
        'The exact words spoken in the audio, transcribed as literally as possible — never translated or summarized. Empty string if no speech is audible at all.',
    },
    detectedLanguage: {
      type: ['string', 'null'],
      enum: ['uz', 'ru', 'en', null],
      description: 'The dominant spoken language, or null if it cannot be determined.',
    },
    confidence: {
      type: 'number',
      description:
        'Your own honest confidence (0.0-1.0) that transcript is an accurate, complete transcription of the audio. Use a LOW value for quiet, muffled, heavily accented, or otherwise hard-to-understand speech — never inflate this to seem helpful.',
    },
    durationSeconds: {
      type: 'number',
      description:
        "Your best estimate of the audio clip's duration in seconds, based on how much speech you heard.",
    },
  },
} as const;

interface StructuredSttOutput {
  transcript: string;
  detectedLanguage: DetectedLanguage | null;
  confidence: number;
  durationSeconds: number;
}

const INSTRUCTION =
  'Transcribe exactly what is spoken in this audio clip — do not translate, summarize, or correct it. ' +
  'The speech may be in Uzbek (Latin or Cyrillic script), Russian, or English. Respond with the ' +
  'structured JSON described by the response schema, nothing else.';

/**
 * The real `SttProvider` implementation, backed by Google's Gemini API —
 * Gemini's native multimodal audio understanding (no separate
 * "transcription endpoint" the way Whisper has one; audio is sent as an
 * inline content part alongside a text instruction, exactly the same
 * request shape this codebase's own `AnthropicVisionOcrProvider` already
 * uses for images) rather than OpenAI's Whisper API — a deliberate vendor
 * choice, not a limitation: Gemini has no audio-transcription-specific
 * confidence/duration fields the way Whisper's `verbose_json` does, so
 * this adapter asks the model to self-report both directly in its
 * structured JSON output, mirroring `AnthropicVisionOcrProvider`'s own
 * "your own honest confidence, never inflate it" instruction pattern
 * exactly rather than inventing a new convention.
 *
 * `GEMINI_API_KEY` is its own, separate credential — distinct from both
 * `ANTHROPIC_API_KEY` (Claude has no audio API) and any OpenAI credential
 * this codebase might otherwise have used.
 *
 * Retry/circuit-breaking is NOT implemented here — `RetryingSttProvider`/
 * `CircuitBreakerSttProvider` (already built for this exact composition)
 * wrap around this class, mirroring `LlmProviderModule`'s own established
 * pattern.
 */
export class GeminiSttProvider implements SttProvider {
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    /** `@google/genai`'s `ApiError` carries no distinct timeout subclass to attach it to (see `mapError`) — the client-level `httpOptions.timeout` below is this adapter's only timeout enforcement. */
    timeoutMs: number,
  ) {
    this.client = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });
  }

  async transcribe(request: SttTranscriptionRequest): Promise<SttTranscriptionResult> {
    let response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;
    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: { data: request.audio.toString('base64'), mimeType: request.mimeType },
              },
              { text: INSTRUCTION },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: STRUCTURED_STT_JSON_SCHEMA,
        },
      });
    } catch (error) {
      throw this.mapError(error);
    }

    const parsed = this.parseResponse(response.text);
    return {
      transcript: parsed.transcript,
      detectedLanguage: parsed.detectedLanguage,
      confidence: parsed.confidence,
      durationSeconds: parsed.durationSeconds,
      providerModelIdentifier: this.model,
    };
  }

  private parseResponse(text: string | undefined): StructuredSttOutput {
    if (!text) {
      throw new SttProviderMalformedResponseError(PROVIDER_NAME);
    }
    let parsed: Partial<StructuredSttOutput> | null;
    try {
      parsed = JSON.parse(text) as Partial<StructuredSttOutput>;
    } catch {
      throw new SttProviderMalformedResponseError(PROVIDER_NAME);
    }
    if (
      !parsed ||
      typeof parsed.transcript !== 'string' ||
      typeof parsed.confidence !== 'number' ||
      typeof parsed.durationSeconds !== 'number'
    ) {
      throw new SttProviderMalformedResponseError(PROVIDER_NAME);
    }
    return {
      transcript: parsed.transcript,
      detectedLanguage: (parsed.detectedLanguage as DetectedLanguage | null | undefined) ?? null,
      confidence: parsed.confidence,
      durationSeconds: parsed.durationSeconds,
    };
  }

  /**
   * Never includes the raw SDK error body or any request/credential detail
   * in the mapped error's message — only the six existing `SttProviderError`
   * subclasses' own fixed, generic messages ever reach a caller.
   *
   * `@google/genai` exposes one unified `ApiError` (an HTTP `status`
   * number), not a class hierarchy per failure category the way
   * Anthropic's/OpenAI's SDKs do — status-code ranges are mapped instead of
   * `instanceof` checks against multiple subclasses.
   */
  private mapError(error: unknown): Error {
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) {
        return new SttProviderAuthenticationError(PROVIDER_NAME);
      }
      if (error.status === 429) {
        return new SttProviderRateLimitError(PROVIDER_NAME);
      }
      if (error.status === 400 || error.status === 422) {
        return new SttProviderInvalidAudioError(
          PROVIDER_NAME,
          'the provider rejected this request',
        );
      }
      return new SttProviderUnavailableError(PROVIDER_NAME);
    }
    return new SttProviderUnavailableError(PROVIDER_NAME);
  }
}
