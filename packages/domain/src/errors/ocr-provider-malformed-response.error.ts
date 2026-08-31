import { OcrProviderError } from './ocr-provider.error';

export class OcrProviderMalformedResponseError extends OcrProviderError {
  constructor(providerName: string) {
    super(`OCR provider "${providerName}" returned a response this adapter could not parse.`);
  }
}
