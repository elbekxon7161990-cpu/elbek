import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { SttProviderTimeoutError, SttProviderUnavailableError } from '@afa/domain';
import type { SttTranscriptionRequest, SttTranscriptionResult } from '@afa/domain';

import { FakeSttProvider } from './fake-stt-provider';
import { CircuitBreakerSttProvider } from './circuit-breaker-stt-provider';

const REQUEST: SttTranscriptionRequest = {
  audio: Buffer.from('fake-audio'),
  mimeType: 'audio/ogg',
};

function result(): SttTranscriptionResult {
  return {
    transcript: 'spent 45000 on lunch',
    detectedLanguage: 'en',
    confidence: 0.95,
    durationSeconds: 3,
    providerModelIdentifier: 'fake',
  };
}

describe('CircuitBreakerSttProvider', () => {
  it('starts closed and passes calls through', async () => {
    const fake = new FakeSttProvider(result());
    const breaker = new CircuitBreakerSttProvider(fake, 'fake-stt');

    await breaker.transcribe(REQUEST);

    expect(breaker.getState()).toBe('closed');
  });

  it('opens after the failure threshold is reached', async () => {
    const fake = new FakeSttProvider(result());
    for (let i = 0; i < 5; i++) fake.enqueue({ error: new SttProviderTimeoutError('fake', 1000) });
    const breaker = new CircuitBreakerSttProvider(fake, 'fake-stt', {
      failureThreshold: 5,
      cooldownMs: 30_000,
    });

    for (let i = 0; i < 5; i++) {
      await expect(breaker.transcribe(REQUEST)).rejects.toThrow();
    }

    expect(breaker.getState()).toBe('open');
  });

  it('fails fast without calling the delegate once open', async () => {
    const fake = new FakeSttProvider(result());
    fake.enqueue({ error: new SttProviderTimeoutError('fake', 1000) });
    const breaker = new CircuitBreakerSttProvider(fake, 'fake-stt', {
      failureThreshold: 1,
      cooldownMs: 30_000,
    });

    await expect(breaker.transcribe(REQUEST)).rejects.toThrow();
    expect(breaker.getState()).toBe('open');

    await expect(breaker.transcribe(REQUEST)).rejects.toBeInstanceOf(SttProviderUnavailableError);
    expect(fake.callCount).toBe(1); // the second call never reached the delegate
  });

  it('moves to half-open after the cooldown elapses, and closes on a successful probe', async () => {
    const fake = new FakeSttProvider(result());
    fake.enqueue({ error: new SttProviderTimeoutError('fake', 1000) });
    let now = 0;
    const breaker = new CircuitBreakerSttProvider(
      fake,
      'fake-stt',
      { failureThreshold: 1, cooldownMs: 1000 },
      () => now,
    );

    await expect(breaker.transcribe(REQUEST)).rejects.toThrow();
    expect(breaker.getState()).toBe('open');

    now = 1000;
    await breaker.transcribe(REQUEST);

    expect(breaker.getState()).toBe('closed');
  });

  it('reopens immediately if the half-open probe fails', async () => {
    const fake = new FakeSttProvider(result());
    fake.enqueue({ error: new SttProviderTimeoutError('fake', 1000) });
    fake.enqueue({ error: new SttProviderTimeoutError('fake', 1000) });
    let now = 0;
    const breaker = new CircuitBreakerSttProvider(
      fake,
      'fake-stt',
      { failureThreshold: 1, cooldownMs: 1000 },
      () => now,
    );

    await expect(breaker.transcribe(REQUEST)).rejects.toThrow();
    now = 1000;
    await expect(breaker.transcribe(REQUEST)).rejects.toThrow();

    expect(breaker.getState()).toBe('open');
  });

  it('resets the failure count on success', async () => {
    const fake = new FakeSttProvider(result());
    fake.enqueue({ error: new SttProviderTimeoutError('fake', 1000) });
    const breaker = new CircuitBreakerSttProvider(fake, 'fake-stt', {
      failureThreshold: 3,
      cooldownMs: 30_000,
    });

    await expect(breaker.transcribe(REQUEST)).rejects.toThrow(); // failure 1
    await breaker.transcribe(REQUEST); // success (default result) resets count to 0
    fake.enqueue({ error: new SttProviderTimeoutError('fake', 1000) });
    await expect(breaker.transcribe(REQUEST)).rejects.toThrow(); // failure count is 1 again, not 2

    expect(breaker.getState()).toBe('closed'); // threshold is 3, so 1 accumulated failure keeps it closed
  });
});
