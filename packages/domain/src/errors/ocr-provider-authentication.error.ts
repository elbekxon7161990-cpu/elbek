import { OcrProviderError } from './ocr-provider.error';

export class OcrProviderAuthenticationError extends OcrProviderError {
  constructor(providerName: string) {
    super(`Authentication/configuration error calling OCR provider "${providerName}".`);
  }
}
