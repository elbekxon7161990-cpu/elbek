import type { OcrExtractionRequest, OcrExtractionResult, OcrProvider } from '@afa/domain';

/**
 * NFR-STT-003's fallback pattern generalized to OCR via §6.18.3. Falls
 * back to `secondary` on any failure from `primary`.
 */
export class FallbackOcrProvider implements OcrProvider {
  constructor(
    private readonly primary: OcrProvider,
    private readonly secondary: OcrProvider,
  ) {}

  async extractText(request: OcrExtractionRequest): Promise<OcrExtractionResult> {
    try {
      return await this.primary.extractText(request);
    } catch {
      return this.secondary.extractText(request);
    }
  }
}
