import { SttProviderError } from './stt-provider.error';

export class SttProviderUnavailableError extends SttProviderError {
  constructor(providerName: string) {
    super(`STT provider "${providerName}" is temporarily unavailable (circuit open).`);
  }
}
