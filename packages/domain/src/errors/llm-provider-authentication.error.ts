import { LlmProviderError } from './llm-provider.error';

/** Invalid/missing/expired credentials, or a configuration error preventing the provider from being reached at all. Never retried (Step 8's explicit rule). */
export class LlmProviderAuthenticationError extends LlmProviderError {
  constructor(providerName: string) {
    super(`Authentication/configuration error calling provider "${providerName}".`);
  }
}
