import { SttProviderError } from './stt-provider.error';

export class SttProviderRateLimitError extends SttProviderError {
  readonly retryAfterMs: number | undefined;

  constructor(providerName: string, retryAfterMs?: number) {
    super(`Rate limit exceeded calling STT provider "${providerName}".`);
    this.retryAfterMs = retryAfterMs;
  }
}
