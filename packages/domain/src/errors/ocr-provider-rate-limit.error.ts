import { OcrProviderError } from './ocr-provider.error';

export class OcrProviderRateLimitError extends OcrProviderError {
  readonly retryAfterMs: number | undefined;

  constructor(providerName: string, retryAfterMs?: number) {
    super(`Rate limit exceeded calling OCR provider "${providerName}".`);
    this.retryAfterMs = retryAfterMs;
  }
}
