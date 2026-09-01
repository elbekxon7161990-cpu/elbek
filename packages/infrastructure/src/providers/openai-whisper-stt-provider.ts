import OpenAI, { toFile } from 'openai';
import {
  SttProviderAuthenticationError,
  SttProviderInvalidAudioError,
  SttProviderMalformedResponseError,
  SttProviderRateLimitError,
  SttProviderTimeoutError,
  SttProviderUnavailableError,
} from '@afa/domain';
import type { DetectedLanguage, SttProvider, SttTranscriptionRequest, SttTranscriptionResult } from '@afa/domain';

const PROVIDER_NAME = 'openai-whisper';

/**
 * Whisper's own detected-language output is a lowercase English language
 * name (e.g. "english", "russian", "uzbek"), not an ISO-639-1 code — this
 * maps the three names this codebase's `DetectedLanguage` cares about;
 * anything else (a real language Whisper detected but this app doesn't
 * support) maps to `null`, matching `SttTranscriptionResult.detectedLanguage`'s
 * own "unknown/unsupported" convention rather than guessing.
 */
const WHISPER_LANGUAGE_NAME_TO_DETECTED_LANGUAGE: Readonly<Record<string, DetectedLanguage>> = {
  uzbek: 'uz',
  russian: 'ru',
  english: 'en',
};

function mapWhisperLanguage(rawLanguage: string | undefined): DetectedLanguage | null {
  if (!rawLanguage) {
    return null;
  }
  return WHISPER_LANGUAGE_NAME_TO_DETECTED_LANGUAGE[rawLanguage.toLowerCase()] ?? null;
}

/**
 * Whisper's transcription API reports no single overall confidence score.
 * `response_format: 'verbose_json'` (this adapter's only response format —
 * see the class doc comment for why) does return per-segment `avg_logprob`
 * (a log probability, typically in roughly [-1, 0] for confident speech),
 * which this averages across segments and exponentiates into an
 * approximate [0, 1] probability-like score — a standard, documented
 * community heuristic for turning Whisper's own log-probabilities into a
 * confidence proxy, not an official OpenAI-provided metric. An empty
 * segment list (silence/no speech detected) maps to 0, matching
 * `FakeSttProvider`'s own "no result" convention.
 */
function estimateConfidence(segments: ReadonlyArray<{ avg_logprob: number }> | undefined): number {
  if (!segments || segments.length === 0) {
    return 0;
  }
  const avgLogprob = segments.reduce((sum, segment) => sum + segment.avg_logprob, 0) / segments.length;
  return Math.min(1, Math.max(0, Math.exp(avgLogprob)));
}

/**
 * The real `SttProvider` implementation, backed by OpenAI's Whisper API — a
 * deliberately SEPARATE vendor from this codebase's existing Anthropic
 * relationship (`AnthropicLlmProvider`/`AnthropicVisionOcrProvider`):
 * Claude has no audio-transcription API, so Speech-to-Text needs its own
 * provider and its own credential (`OPENAI_API_KEY`), never conflated with
 * `ANTHROPIC_API_KEY`.
 *
 * `whisper-1` specifically (not `gpt-4o-transcribe`/`gpt-4o-mini-transcribe`)
 * is this adapter's target model: it is the only OpenAI transcription model
 * that supports `response_format: 'verbose_json'`, which is what surfaces
 * `language`/`duration`/per-segment `avg_logprob` — every field this port's
 * `SttTranscriptionResult` needs beyond the bare transcript text. A
 * `model` override is still accepted (`OPENAI_STT_MODEL`) for a future
 * model change, but callers should be aware other models won't return the
 * same fields.
 *
 * Retry/circuit-breaking is NOT implemented here — `RetryingSttProvider`/
 * `CircuitBreakerSttProvider` (already built for this exact composition,
 * mirroring `LlmProviderModule`'s own established pattern) wrap around this
 * class. The OpenAI SDK client this class is constructed with must be
 * configured with `maxRetries: 0` by its caller so the SDK's own internal
 * retry never doubles up with `RetryingSttProvider`'s.
 */
export class OpenAiWhisperSttProvider implements SttProvider {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    /** The `timeout` the client was configured with (ms) — surfaced on `SttProviderTimeoutError`, since the SDK's own timeout error doesn't carry it back out. */
    private readonly timeoutMs: number,
  ) {}

  async transcribe(request: SttTranscriptionRequest): Promise<SttTranscriptionResult> {
    const startedAt = Date.now();
    let response: OpenAI.Audio.Transcriptions.TranscriptionVerbose;
    try {
      response = await this.client.audio.transcriptions.create({
        file: await toFile(request.audio, 'audio.ogg', { type: request.mimeType }),
        model: this.model,
        response_format: 'verbose_json',
      });
    } catch (error) {
      throw this.mapError(error);
    }

    if (typeof response.text !== 'string') {
      throw new SttProviderMalformedResponseError(PROVIDER_NAME);
    }

    return {
      transcript: response.text,
      detectedLanguage: mapWhisperLanguage(response.language),
      confidence: estimateConfidence(response.segments),
      durationSeconds: response.duration ?? (Date.now() - startedAt) / 1000,
      providerModelIdentifier: this.model,
    };
  }

  /**
   * Never includes the raw SDK error body or any request/credential detail
   * in the mapped error's message — only the six existing `SttProviderError`
   * subclasses' own fixed, generic messages ever reach a caller.
   */
  private mapError(error: unknown): Error {
    if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
      return new SttProviderAuthenticationError(PROVIDER_NAME);
    }
    if (error instanceof OpenAI.RateLimitError) {
      return new SttProviderRateLimitError(PROVIDER_NAME, this.extractRetryAfterMs(error));
    }
    // Must precede the APIConnectionError check below — APIConnectionTimeoutError extends it.
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      return new SttProviderTimeoutError(PROVIDER_NAME, this.timeoutMs);
    }
    if (
      error instanceof OpenAI.BadRequestError ||
      error instanceof OpenAI.UnprocessableEntityError ||
      error instanceof OpenAI.NotFoundError
    ) {
      return new SttProviderInvalidAudioError(PROVIDER_NAME, 'the provider rejected this request');
    }
    if (error instanceof OpenAI.APIError) {
      return new SttProviderUnavailableError(PROVIDER_NAME);
    }
    return new SttProviderUnavailableError(PROVIDER_NAME);
  }

  private extractRetryAfterMs(error: InstanceType<typeof OpenAI.RateLimitError>): number | undefined {
    try {
      const header = error.headers?.get('retry-after');
      if (!header) {
        return undefined;
      }
      const seconds = Number(header);
      return Number.isFinite(seconds) ? seconds * 1000 : undefined;
    } catch {
      return undefined;
    }
  }
}
