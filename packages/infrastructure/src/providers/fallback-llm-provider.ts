import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from '@afa/domain';

/**
 * §3.14.3 tier 2 ("Fallback provider — if configured for that provider
 * category, switch silently") / §4.9 ("on second failure, fall back to a
 * configured secondary model/provider if available"). Falls back on any
 * failure from `primary` — including auth/invalid-request errors, unlike
 * `RetryingLlmProvider`'s same-provider retry: a different provider has
 * different credentials and a different request-validation surface, so an
 * error that is genuinely non-retryable *against the same provider* is not
 * necessarily non-recoverable *against a different one*.
 */
export class FallbackLlmProvider implements LlmProvider {
  constructor(
    private readonly primary: LlmProvider,
    private readonly secondary: LlmProvider,
  ) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    try {
      return await this.primary.complete(request);
    } catch {
      return this.secondary.complete(request);
    }
  }
}
