import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { OcrProviderTimeoutError, OcrProviderUnavailableError } from '@afa/domain';
import type { OcrExtractionRequest, OcrExtractionResult } from '@afa/domain';

import { FakeOcrProvider } from './fake-ocr-provider';
import { CircuitBreakerOcrProvider } from './circuit-breaker-ocr-provider';

const REQUEST: OcrExtractionRequest = { image: Buffer.from('fake-image'), mimeType: 'image/jpeg' };

function result(): OcrExtractionResult {
  return {
    rawText: 'Korzinka\nTotal: 45000',
    contentClassification: 'receipt',
    detectedLanguage: 'en',
    confidence: 0.9,
    providerModelIdentifier: 'fake',
    processingDurationMs: 500,
  };
}

describe('CircuitBreakerOcrProvider', () => {
  it('starts closed and passes calls through', async () => {
    const fake = new FakeOcrProvider(result());
    const breaker = new CircuitBreakerOcrProvider(fake, 'fake-ocr');

    await breaker.extractText(REQUEST);

    expect(breaker.getState()).toBe('closed');
  });

  it('opens after the failure threshold is reached', async () => {
    const fake = new FakeOcrProvider(result());
    for (let i = 0; i < 5; i++) fake.enqueue({ error: new OcrProviderTimeoutError('fake', 1000) });
    const breaker = new CircuitBreakerOcrProvider(fake, 'fake-ocr', {
      failureThreshold: 5,
      cooldownMs: 30_000,
    });

    for (let i = 0; i < 5; i++) {
      await expect(breaker.extractText(REQUEST)).rejects.toThrow();
    }

    expect(breaker.getState()).toBe('open');
  });

  it('fails fast without calling the delegate once open', async () => {
    const fake = new FakeOcrProvider(result());
    fake.enqueue({ error: new OcrProviderTimeoutError('fake', 1000) });
    const breaker = new CircuitBreakerOcrProvider(fake, 'fake-ocr', {
      failureThreshold: 1,
      cooldownMs: 30_000,
    });

    await expect(breaker.extractText(REQUEST)).rejects.toThrow();
    expect(breaker.getState()).toBe('open');

    await expect(breaker.extractText(REQUEST)).rejects.toBeInstanceOf(OcrProviderUnavailableError);
    expect(fake.callCount).toBe(1);
  });

  it('moves to half-open after the cooldown elapses, and closes on a successful probe', async () => {
    const fake = new FakeOcrProvider(result());
    fake.enqueue({ error: new OcrProviderTimeoutError('fake', 1000) });
    let now = 0;
    const breaker = new CircuitBreakerOcrProvider(
      fake,
      'fake-ocr',
      { failureThreshold: 1, cooldownMs: 1000 },
      () => now,
    );

    await expect(breaker.extractText(REQUEST)).rejects.toThrow();
    expect(breaker.getState()).toBe('open');

    now = 1000;
    await breaker.extractText(REQUEST);

    expect(breaker.getState()).toBe('closed');
  });

  it('reopens immediately if the half-open probe fails', async () => {
    const fake = new FakeOcrProvider(result());
    fake.enqueue({ error: new OcrProviderTimeoutError('fake', 1000) });
    fake.enqueue({ error: new OcrProviderTimeoutError('fake', 1000) });
    let now = 0;
    const breaker = new CircuitBreakerOcrProvider(
      fake,
      'fake-ocr',
      { failureThreshold: 1, cooldownMs: 1000 },
      () => now,
    );

    await expect(breaker.extractText(REQUEST)).rejects.toThrow();
    now = 1000;
    await expect(breaker.extractText(REQUEST)).rejects.toThrow();

    expect(breaker.getState()).toBe('open');
  });

  it('resets the failure count on success', async () => {
    const fake = new FakeOcrProvider(result());
    fake.enqueue({ error: new OcrProviderTimeoutError('fake', 1000) });
    const breaker = new CircuitBreakerOcrProvider(fake, 'fake-ocr', {
      failureThreshold: 3,
      cooldownMs: 30_000,
    });

    await expect(breaker.extractText(REQUEST)).rejects.toThrow();
    await breaker.extractText(REQUEST);
    fake.enqueue({ error: new OcrProviderTimeoutError('fake', 1000) });
    await expect(breaker.extractText(REQUEST)).rejects.toThrow();

    expect(breaker.getState()).toBe('closed');
  });
});
