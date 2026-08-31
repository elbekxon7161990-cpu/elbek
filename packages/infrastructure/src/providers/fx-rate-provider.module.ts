import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FX_RATE_PROVIDER } from '@afa/domain';
import type { FxRateProvider } from '@afa/domain';
import type { EnvironmentVariables } from '@afa/shared';

import { FakeFxRateProvider } from './fake-fx-rate-provider';

const logger = new Logger('FxRateProviderModule');

/**
 * Exported for direct unit testing of the selection/fail-fast logic without
 * standing up a full Nest DI container — mirrors `buildLlmProvider`'s exact
 * shape, minus a real-vendor branch: TASK-FIN-007 Stage F's own scope
 * explicitly excludes selecting or inventing a real FX vendor (the PRD
 * names none, Chapter 18 §18.1's own table leaves the row blank where the
 * LLM row says "e.g., Claude/Anthropic"). When a real vendor is eventually
 * chosen, only this function needs a real branch added, mirroring how
 * `buildLlmProvider` itself gained its real branch in TASK-INFRA-AI-REAL-001
 * without any other file changing.
 */
export function buildFxRateProvider(
  config: ConfigService<EnvironmentVariables, true>,
): FxRateProvider {
  const allowFake = config.get('ALLOW_FAKE_FX_RATE_PROVIDER', { infer: true });
  if (allowFake) {
    logger.warn(
      'ALLOW_FAKE_FX_RATE_PROVIDER=true — binding a FAKE FxRateProvider. No real exchange rate will be fetched. This must never be true in a production deployment.',
    );
    return new FakeFxRateProvider([]);
  }

  // Fail loud, at startup — never silently run FX ingestion against nothing.
  // No real adapter exists for this port yet (see this file's own doc
  // comment) — until one is added, this factory has no real branch, only
  // fake-or-fail-fast.
  throw new Error(
    'FX_RATE_PROVIDER is not configured: no real FX rate provider is implemented yet. Set ALLOW_FAKE_FX_RATE_PROVIDER=true to bind a fake provider for local development only — never in production.',
  );
}

/**
 * TASK-FIN-007 Stage F — the composition root for `FX_RATE_PROVIDER`.
 * `@Global()` (same reasoning as `LlmProviderModule`'s own doc comment) —
 * a sibling import under a shared parent module does not make
 * `FX_RATE_PROVIDER` visible to whichever module needs it
 * (`IngestFxRatesUseCase`, `@afa/application`) without this.
 */
@Global()
@Module({
  providers: [
    {
      provide: FX_RATE_PROVIDER,
      useFactory: buildFxRateProvider,
      inject: [ConfigService],
    },
  ],
  exports: [FX_RATE_PROVIDER],
})
export class FxRateProviderModule {}
