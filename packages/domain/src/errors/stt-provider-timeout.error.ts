import { SttProviderError } from './stt-provider.error';

export class SttProviderTimeoutError extends SttProviderError {
  constructor(providerName: string, timeoutMs: number) {
    super(`STT provider "${providerName}" call exceeded its ${timeoutMs}ms timeout.`);
  }
}
