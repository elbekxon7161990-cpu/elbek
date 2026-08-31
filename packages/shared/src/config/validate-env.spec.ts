import { describe, expect, it } from 'vitest';

import { validateEnv } from './validate-env';

const REQUIRED = { DATABASE_URL: 'postgresql://x', REDIS_URL: 'redis://x' };

describe('validateEnv', () => {
  it('accepts the minimal required config', () => {
    const result = validateEnv(REQUIRED);
    expect(result.DATABASE_URL).toBe(REQUIRED.DATABASE_URL);
    expect(result.REDIS_URL).toBe(REQUIRED.REDIS_URL);
  });

  it('throws when a required variable is missing', () => {
    expect(() => validateEnv({ REDIS_URL: 'redis://x' })).toThrow(/Environment validation failed/);
  });

  /**
   * TASK-MVP-002 — regression test for a real, live-environment bug:
   * `plainToInstance(..., { enableImplicitConversion: true })` applied
   * plain `Boolean(value)` on top of `ALLOW_FAKE_TRANSACTION_COMMIT`'s own
   * `@Transform`, and `Boolean("false")` is `true` in JavaScript — any
   * non-empty string, including the literal string `"false"`, was silently
   * read back as `true`. This flag gates whether a real deployment commits
   * financial transactions for real or through a fake — it must resolve
   * the same value that would be written to a real `.env` file.
   */
  it.each([
    ['false', false],
    ['true', true],
    ['1', true],
    ['0', false],
  ])(
    'ALLOW_FAKE_TRANSACTION_COMMIT=%s resolves to boolean %s, never truthy-by-presence',
    (raw, expected) => {
      const result = validateEnv({ ...REQUIRED, ALLOW_FAKE_TRANSACTION_COMMIT: raw });
      expect(result.ALLOW_FAKE_TRANSACTION_COMMIT).toBe(expected);
    },
  );

  it.each([
    ['false', false],
    ['true', true],
  ])(
    'ALLOW_FAKE_LLM_PROVIDER=%s resolves to boolean %s (same @Transform pattern)',
    (raw, expected) => {
      const result = validateEnv({ ...REQUIRED, ALLOW_FAKE_LLM_PROVIDER: raw });
      expect(result.ALLOW_FAKE_LLM_PROVIDER).toBe(expected);
    },
  );

  it('leaves ALLOW_FAKE_TRANSACTION_COMMIT undefined (not true) when entirely absent', () => {
    const result = validateEnv(REQUIRED);
    expect(result.ALLOW_FAKE_TRANSACTION_COMMIT).toBeUndefined();
  });

  it('still numerically converts PORT via its own explicit @Transform', () => {
    const result = validateEnv({ ...REQUIRED, PORT: '3000' });
    expect(result.PORT).toBe(3000);
  });

  it('still numerically converts ANTHROPIC_MAX_OUTPUT_TOKENS via its own explicit @Transform', () => {
    const result = validateEnv({ ...REQUIRED, ANTHROPIC_MAX_OUTPUT_TOKENS: '500' });
    expect(result.ANTHROPIC_MAX_OUTPUT_TOKENS).toBe(500);
  });

  it('leaves ANTHROPIC_MAX_OUTPUT_TOKENS undefined when absent, never NaN', () => {
    const result = validateEnv(REQUIRED);
    expect(result.ANTHROPIC_MAX_OUTPUT_TOKENS).toBeUndefined();
  });
});
