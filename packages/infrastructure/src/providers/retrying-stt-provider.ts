import { SttProviderAuthenticationError, SttProviderInvalidAudioError } from '@afa/domain';
import type { SttProvider, SttTranscriptionRequest, SttTranscriptionResult } from '@afa/domain';

export interface SttRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export const DEFAULT_STT_RETRY_POLICY: SttRetryPolicy = { maxAttempts: 2, backoffMs: 250 };

export type SttDelayFn = (ms: number) => Promise<void>;

const defaultDelay: SttDelayFn = (ms) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, ms));

/**
 * §6.18.3 ("Provider timeout/error (STT, OCR) — Retry with backoff, then
 * fallback provider if configured, then graceful message — identical
 * pattern to Chapter 4 §4.9"). Mirrors `RetryingLlmProvider`'s structure
 * exactly (TASK-INFRA-010's own established pattern for this concern), not
 * reimplemented from scratch, applied to the `SttProvider` port.
 *
 * Never retries `SttProviderAuthenticationError` (same credentials will
 * fail identically) or `SttProviderInvalidAudioError` (the same audio
 * bytes will be rejected identically by the same provider) — both are
 * request-shape/credential problems a retry cannot fix.
 */
export class RetryingSttProvider implements SttProvider {
  constructor(
    private readonly delegate: SttProvider,
    private readonly policy: SttRetryPolicy = DEFAULT_STT_RETRY_POLICY,
    private readonly delayFn: SttDelayFn = defaultDelay,
  ) {}

  async transcribe(request: SttTranscriptionRequest): Promise<SttTranscriptionResult> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt++) {
      try {
        return await this.delegate.transcribe(request);
      } catch (error) {
        lastError = error;
        if (
          error instanceof SttProviderAuthenticationError ||
          error instanceof SttProviderInvalidAudioError
        ) {
          throw error;
        }
        if (attempt < this.policy.maxAttempts) {
          await this.delayFn(this.policy.backoffMs * attempt);
        }
      }
    }

    throw lastError;
  }
}
