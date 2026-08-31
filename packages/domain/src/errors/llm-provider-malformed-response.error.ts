import { LlmProviderError } from './llm-provider.error';

/** The provider's response could not even be parsed into `LlmCompletionResult` (e.g. an empty/unexpected body) — distinct from a schema-invalid *content*, which is TASK-AI-001's own concern, not this port's. */
export class LlmProviderMalformedResponseError extends LlmProviderError {
  constructor(providerName: string) {
    super(`Provider "${providerName}" returned a response this adapter could not parse.`);
  }
}
