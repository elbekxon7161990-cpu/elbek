import { SttProviderError } from './stt-provider.error';

export class SttProviderAuthenticationError extends SttProviderError {
  constructor(providerName: string) {
    super(`Authentication/configuration error calling STT provider "${providerName}".`);
  }
}
