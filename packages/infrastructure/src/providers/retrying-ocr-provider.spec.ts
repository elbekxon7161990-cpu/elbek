import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  OcrProviderAuthenticationError,
  OcrProviderInvalidImageError,
  OcrProviderTimeoutError,
} from '@afa/domain';
import type { OcrExtractionRequest, OcrExtractionResult } from '@afa/domain';

import { FakeOcrProvider } from './fake-ocr-provider';
import { RetryingOcrProvider } from './retrying-ocr-provider';

const REQUEST: OcrExtractionRequest = { image: Buffer.from('fake-image'), mimeType: 'image/jpeg' };

function result(overrides: Partial<OcrExtractionResult> = {}): OcrExtractionResult {
  return {
    rawText: 'Korzinka\nTotal: 45000',
    contentClassification: 'receipt',
    detectedLanguage: 'en',
    confidence: 0.9,
    providerModelIdentifier: 'fake-ocr-model',
    processingDurationMs: 500,
    ...overrides,
  };
}

describe('RetryingOcrProvider', () => {
  it('returns the result immediately on first-attempt success, no retry', async () => {
    const fake = new FakeOcrProvider(result());
    const provider = new RetryingOcrProvider(fake, { maxAttempts: 2, backoffMs: 1 });

    await provider.extractText(REQUEST);

    expect(fake.callCount).toBe(1);
  });

  it('retries once on a transient timeout, then succeeds', async () => {
    const fake = new FakeOcrProvider(result());
    fake.enqueue({ error: new OcrProviderTimeoutError('fake', 8000) });
    const provider = new RetryingOcrProvider(fake, { maxAttempts: 2, backoffMs: 1 });

    const outcome = await provider.extractText(REQUEST);

    expect(fake.callCount).toBe(2);
    expect(outcome.rawText).toContain('Korzinka');
  });

  it('exhausts retries and throws the last error', async () => {
    const fake = new FakeOcrProvider(result());
    fake.enqueue({ error: new OcrProviderTimeoutError('fake', 8000) });
    fake.enqueue({ error: new OcrProviderTimeoutError('fake', 8000) });
    const provider = new RetryingOcrProvider(fake, { maxAttempts: 2, backoffMs: 1 });

    await expect(provider.extractText(REQUEST)).rejects.toBeInstanceOf(OcrProviderTimeoutError);
    expect(fake.callCount).toBe(2);
  });

  it('never retries an authentication error', async () => {
    const fake = new FakeOcrProvider(result());
    fake.enqueue({ error: new OcrProviderAuthenticationError('fake') });
    const provider = new RetryingOcrProvider(fake, { maxAttempts: 3, backoffMs: 1 });

    await expect(provider.extractText(REQUEST)).rejects.toBeInstanceOf(
      OcrProviderAuthenticationError,
    );
    expect(fake.callCount).toBe(1);
  });

  it('never retries an invalid-image error', async () => {
    const fake = new FakeOcrProvider(result());
    fake.enqueue({ error: new OcrProviderInvalidImageError('fake', 'corrupted') });
    const provider = new RetryingOcrProvider(fake, { maxAttempts: 3, backoffMs: 1 });

    await expect(provider.extractText(REQUEST)).rejects.toBeInstanceOf(
      OcrProviderInvalidImageError,
    );
    expect(fake.callCount).toBe(1);
  });

  it('applies backoff between retries', async () => {
    const fake = new FakeOcrProvider(result());
    fake.enqueue({ error: new OcrProviderTimeoutError('fake', 8000) });
    const delayFn = vi.fn().mockResolvedValue(undefined);
    const provider = new RetryingOcrProvider(fake, { maxAttempts: 2, backoffMs: 250 }, delayFn);

    await provider.extractText(REQUEST);

    expect(delayFn).toHaveBeenCalledWith(250);
  });
});
