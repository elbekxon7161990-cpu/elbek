import { LlmProviderError } from './llm-provider.error';

/** §3.14.2 — the circuit breaker is Open (sustained failures); the call was rejected without even attempting the provider. */
export class LlmProviderUnavailableError extends LlmProviderError {
  constructor(providerName: string) {
    super(`Provider "${providerName}" is temporarily unavailable (circuit open).`);
  }
}
