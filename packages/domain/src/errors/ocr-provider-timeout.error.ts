import { OcrProviderError } from './ocr-provider.error';

export class OcrProviderTimeoutError extends OcrProviderError {
  constructor(providerName: string, timeoutMs: number) {
    super(`OCR provider "${providerName}" call exceeded its ${timeoutMs}ms timeout.`);
  }
}
