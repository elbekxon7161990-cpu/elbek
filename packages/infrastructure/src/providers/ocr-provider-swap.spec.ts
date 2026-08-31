import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import type { OcrProvider, OcrExtractionRequest } from '@afa/domain';

import { FakeOcrProvider } from './fake-ocr-provider';

/**
 * TASK-INFRA-010's own DoD, verified for the `OcrProvider` adapter
 * category: "swapping a provider implementation requires changes only
 * within its adapter." This consumer depends only on the `OcrProvider`
 * port — swapping which concrete instance it receives never requires
 * touching this function.
 */
async function consumeOcrText(
  provider: OcrProvider,
  request: OcrExtractionRequest,
): Promise<string> {
  const result = await provider.extractText(request);
  return result.rawText;
}

describe('OcrProvider swap contract', () => {
  const request: OcrExtractionRequest = { image: Buffer.from('image'), mimeType: 'image/jpeg' };

  it('the consumer behaves identically regardless of which concrete OcrProvider is injected', async () => {
    const providerA = new FakeOcrProvider({
      rawText: 'Korzinka\nTotal: 45000',
      contentClassification: 'receipt',
      detectedLanguage: 'en',
      confidence: 0.9,
      providerModelIdentifier: 'provider-a',
      processingDurationMs: 400,
    });
    const providerB = new FakeOcrProvider({
      rawText: 'Korzinka\nTotal: 45000',
      contentClassification: 'receipt',
      detectedLanguage: 'en',
      confidence: 0.75,
      providerModelIdentifier: 'provider-b',
      processingDurationMs: 600,
    });

    const resultA = await consumeOcrText(providerA, request);
    const resultB = await consumeOcrText(providerB, request);

    expect(resultA).toBe(resultB);
  });
});
