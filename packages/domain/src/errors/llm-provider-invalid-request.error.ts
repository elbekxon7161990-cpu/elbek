import { LlmProviderError } from './llm-provider.error';

/** The provider rejected the request itself (bad model name, invalid parameters) — never retried, the request would fail identically every time. */
export class LlmProviderInvalidRequestError extends LlmProviderError {
  constructor(providerName: string, reason: string) {
    super(`Provider "${providerName}" rejected the request: ${reason}`);
  }
}
