import { OcrProviderAuthenticationError, OcrProviderInvalidImageError } from '@afa/domain';
import type { OcrExtractionRequest, OcrExtractionResult, OcrProvider } from '@afa/domain';

export interface OcrRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export const DEFAULT_OCR_RETRY_POLICY: OcrRetryPolicy = { maxAttempts: 2, backoffMs: 250 };

export type OcrDelayFn = (ms: number) => Promise<void>;

const defaultDelay: OcrDelayFn = (ms) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, ms));

/**
 * §6.18.3 ("Provider timeout/error (STT, OCR) — Retry with backoff, then
 * fallback provider if configured, then graceful message — identical
 * pattern to Chapter 4 §4.9"). Mirrors `RetryingSttProvider`'s structure
 * exactly (TASK-AI-005's own established pattern), applied to the
 * `OcrProvider` port.
 *
 * Never retries `OcrProviderAuthenticationError` (same credentials will
 * fail identically) or `OcrProviderInvalidImageError` (the same image
 * bytes will be rejected identically by the same provider).
 */
export class RetryingOcrProvider implements OcrProvider {
  constructor(
    private readonly delegate: OcrProvider,
    private readonly policy: OcrRetryPolicy = DEFAULT_OCR_RETRY_POLICY,
    private readonly delayFn: OcrDelayFn = defaultDelay,
  ) {}

  async extractText(request: OcrExtractionRequest): Promise<OcrExtractionResult> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt++) {
      try {
        return await this.delegate.extractText(request);
      } catch (error) {
        lastError = error;
        if (
          error instanceof OcrProviderAuthenticationError ||
          error instanceof OcrProviderInvalidImageError
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
