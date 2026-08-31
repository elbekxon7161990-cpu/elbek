import { OcrProviderError } from './ocr-provider.error';

/**
 * The provider itself rejected the image (e.g. genuinely corrupted beyond
 * what `evaluateImageValidity`'s own pre-call check could detect, or a
 * content type the provider can't decode despite passing our MIME check)
 * — distinct from that pre-flight validation, which returns a result
 * rather than throwing (see `evaluate-image-validity.ts`).
 */
export class OcrProviderInvalidImageError extends OcrProviderError {
  constructor(providerName: string, reason: string) {
    super(`OCR provider "${providerName}" rejected the image: ${reason}`);
  }
}
