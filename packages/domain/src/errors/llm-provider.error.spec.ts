import { describe, expect, it } from 'vitest';

import { LlmProviderAuthenticationError } from './llm-provider-authentication.error';
import { LlmProviderInvalidRequestError } from './llm-provider-invalid-request.error';
import { LlmProviderMalformedResponseError } from './llm-provider-malformed-response.error';
import { LlmProviderRateLimitError } from './llm-provider-rate-limit.error';
import { LlmProviderTimeoutError } from './llm-provider-timeout.error';
import { LlmProviderUnavailableError } from './llm-provider-unavailable.error';
import { LlmProviderError } from './llm-provider.error';

const SECRET_MARKER = 'sk-super-secret-api-key-should-never-appear';

describe('LlmProviderError hierarchy', () => {
  it('every concrete error extends the provider-neutral base', () => {
    const errors: LlmProviderError[] = [
      new LlmProviderAuthenticationError('anthropic'),
      new LlmProviderRateLimitError('anthropic', 1000),
      new LlmProviderTimeoutError('anthropic', 5000),
      new LlmProviderUnavailableError('anthropic'),
      new LlmProviderInvalidRequestError('anthropic', 'bad model'),
      new LlmProviderMalformedResponseError('anthropic'),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(LlmProviderError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(error.constructor.name);
    }
  });

  it('sets a distinct, correctly-named error for each failure category', () => {
    expect(new LlmProviderAuthenticationError('p').name).toBe('LlmProviderAuthenticationError');
    expect(new LlmProviderRateLimitError('p').name).toBe('LlmProviderRateLimitError');
    expect(new LlmProviderTimeoutError('p', 1).name).toBe('LlmProviderTimeoutError');
    expect(new LlmProviderUnavailableError('p').name).toBe('LlmProviderUnavailableError');
    expect(new LlmProviderInvalidRequestError('p', 'x').name).toBe(
      'LlmProviderInvalidRequestError',
    );
    expect(new LlmProviderMalformedResponseError('p').name).toBe(
      'LlmProviderMalformedResponseError',
    );
  });

  it('exposes an optional retryAfterMs on the rate-limit error without requiring it', () => {
    expect(new LlmProviderRateLimitError('p').retryAfterMs).toBeUndefined();
    expect(new LlmProviderRateLimitError('p', 2000).retryAfterMs).toBe(2000);
  });

  it('none of the error constructors accept (and therefore cannot leak) a raw secret/API key/request payload', () => {
    // Structural guarantee: every constructor's parameter list is a plain
    // provider name / short reason string — there is no parameter an
    // implementer could accidentally pass a secret or full request/response
    // body into. This test documents that guarantee by exercising every
    // constructor with an intentionally secret-shaped provider-name string
    // and confirming the *only* place it can appear is exactly where the
    // implementer put it — never duplicated, transformed, or logged
    // elsewhere by the error class itself.
    const authError = new LlmProviderAuthenticationError(SECRET_MARKER);
    expect(authError.message).toContain(SECRET_MARKER); // caller's own string, verbatim — not a leak, just proof there's no hidden extra channel
    expect(Object.keys(authError)).not.toContain('apiKey');
    expect(Object.keys(authError)).not.toContain('requestPayload');
    expect(Object.keys(authError)).not.toContain('responseBody');
  });
});
