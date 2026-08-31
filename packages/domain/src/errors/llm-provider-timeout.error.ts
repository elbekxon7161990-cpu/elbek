import { LlmProviderError } from './llm-provider.error';

/** §3.16.3 — the call exceeded its allocated timeout budget. */
export class LlmProviderTimeoutError extends LlmProviderError {
  constructor(providerName: string, timeoutMs: number) {
    super(`Provider "${providerName}" call exceeded its ${timeoutMs}ms timeout.`);
  }
}
