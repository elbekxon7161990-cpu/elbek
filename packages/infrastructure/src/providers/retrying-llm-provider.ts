import { LlmProviderAuthenticationError, LlmProviderInvalidRequestError } from '@afa/domain';
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from '@afa/domain';

export interface RetryPolicy {
  /** Total attempts including the first — 2 means "retry once", matching §4.9's "Primary LLM provider timeout/error → Retry once with backoff". */
  maxAttempts: number;
  backoffMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 2, backoffMs: 250 };

export type DelayFn = (ms: number) => Promise<void>;

const defaultDelay: DelayFn = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

/**
 * §3.14.3 tier 1 ("Retry — transient failure, invisible to the user if it
 * succeeds within the latency budget"). Wraps any `LlmProvider` — swapping
 * the wrapped provider never requires a change here (TASK-INFRA-010's own
 * DoD).
 *
 * Step 8's explicit rule: never retries `LlmProviderAuthenticationError` or
 * `LlmProviderInvalidRequestError` — both would fail identically on a
 * second attempt against the same provider/credentials, so retrying is
 * pure wasted latency, not resilience.
 */
export class RetryingLlmProvider implements LlmProvider {
  constructor(
    private readonly delegate: LlmProvider,
    private readonly policy: RetryPolicy = DEFAULT_RETRY_POLICY,
    private readonly delayFn: DelayFn = defaultDelay,
  ) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt++) {
      try {
        return await this.delegate.complete(request);
      } catch (error) {
        lastError = error;
        if (
          error instanceof LlmProviderAuthenticationError ||
          error instanceof LlmProviderInvalidRequestError
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
