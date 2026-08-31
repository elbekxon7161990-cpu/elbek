import { LlmProviderError } from './llm-provider.error';

/** §3.16.4 outbound rate limiting — the provider (or this system's own outbound limiter) rejected the call. */
export class LlmProviderRateLimitError extends LlmProviderError {
  readonly retryAfterMs: number | undefined;

  constructor(providerName: string, retryAfterMs?: number) {
    super(`Rate limit exceeded calling provider "${providerName}".`);
    this.retryAfterMs = retryAfterMs;
  }
}
