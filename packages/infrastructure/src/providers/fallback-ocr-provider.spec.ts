import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { OcrProviderAuthenticationError, OcrProviderTimeoutError } from '@afa/domain';
import type { OcrExtractionRequest, OcrExtractionResult } from '@afa/domain';

import { FakeOcrProvider } from './fake-ocr-provider';
import { FallbackOcrProvider } from './fallback-ocr-provider';

const REQUEST: OcrExtractionRequest = { image: Buffer.from('fake-image'), mimeType: 'image/jpeg' };

function result(providerModelIdentifier: string): OcrExtractionResult {
  return {
    rawText: 'Korzinka\nTotal: 45000',
    contentClassification: 'receipt',
    detectedLanguage: 'en',
    confidence: 0.9,
    providerModelIdentifier,
    processingDurationMs: 500,
  };
}

describe('FallbackOcrProvider', () => {
  it('uses the primary provider when it succeeds', async () => {
    const primary = new FakeOcrProvider(result('primary'));
    const secondary = new FakeOcrProvider(result('secondary'));
    const provider = new FallbackOcrProvider(primary, secondary);

    const outcome = await provider.extractText(REQUEST);

    expect(outcome.providerModelIdentifier).toBe('primary');
    expect(secondary.callCount).toBe(0);
  });

  it('falls back to the secondary provider when the primary fails', async () => {
    const primary = new FakeOcrProvider(result('primary'));
    primary.enqueue({ error: new OcrProviderTimeoutError('primary', 8000) });
    const secondary = new FakeOcrProvider(result('secondary'));
    const provider = new FallbackOcrProvider(primary, secondary);

    const outcome = await provider.extractText(REQUEST);

    expect(outcome.providerModelIdentifier).toBe('secondary');
  });

  it('falls back even on an authentication error (a different provider has different credentials)', async () => {
    const primary = new FakeOcrProvider(result('primary'));
    primary.enqueue({ error: new OcrProviderAuthenticationError('primary') });
    const secondary = new FakeOcrProvider(result('secondary'));
    const provider = new FallbackOcrProvider(primary, secondary);

    const outcome = await provider.extractText(REQUEST);

    expect(outcome.providerModelIdentifier).toBe('secondary');
  });

  it("propagates the secondary's error if both fail", async () => {
    const primary = new FakeOcrProvider(result('primary'));
    primary.enqueue({ error: new OcrProviderTimeoutError('primary', 8000) });
    const secondary = new FakeOcrProvider(result('secondary'));
    secondary.enqueue({ error: new OcrProviderTimeoutError('secondary', 8000) });
    const provider = new FallbackOcrProvider(primary, secondary);

    await expect(provider.extractText(REQUEST)).rejects.toBeInstanceOf(OcrProviderTimeoutError);
  });
});
