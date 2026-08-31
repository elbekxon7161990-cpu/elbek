import { SttProviderError } from './stt-provider.error';

export class SttProviderMalformedResponseError extends SttProviderError {
  constructor(providerName: string) {
    super(`STT provider "${providerName}" returned a response this adapter could not parse.`);
  }
}
