import { OcrProviderError } from './ocr-provider.error';

export class OcrProviderUnavailableError extends OcrProviderError {
  constructor(providerName: string) {
    super(`OCR provider "${providerName}" is temporarily unavailable (circuit open).`);
  }
}
