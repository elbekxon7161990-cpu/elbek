import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { EnvironmentVariables } from './environment-variables';

/**
 * Fail-fast startup validation: an app with a missing/malformed required
 * environment variable must refuse to start, never limp along with an
 * undefined DATABASE_URL discovered only on first query.
 *
 * Deliberately NOT `enableImplicitConversion: true` (TASK-MVP-002 — a real,
 * live-environment bug this option caused, discovered the first time a real
 * Anthropic call ever reached the transaction-commit step): every
 * non-`string` field in `EnvironmentVariables` already carries its own
 * explicit `@Transform` (`PORT`, `ANTHROPIC_TEMPERATURE`,
 * `ANTHROPIC_MAX_OUTPUT_TOKENS`, `ALLOW_FAKE_LLM_PROVIDER`,
 * `ALLOW_FAKE_TRANSACTION_COMMIT`), so implicit, design-type-driven
 * conversion is never needed — and for a `boolean`-typed field specifically,
 * `class-transformer`'s implicit conversion applies plain `Boolean(value)`
 * to whatever the custom `@Transform` already returned, which turns *any*
 * non-empty string truthy — including the literal string `"false"`.
 * `ALLOW_FAKE_TRANSACTION_COMMIT="false"` was therefore always being read
 * back as boolean `true`, silently binding a `FakeTransactionCommitPort` in
 * what was configured, correctly, to be a real deployment. Confirmed this
 * class's own explicit transforms handle every field correctly without it.
 */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config);

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Environment validation failed: ${details}`);
  }

  return validatedConfig;
}
