import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@afa/shared';

import { FakeFxRateProvider } from './fake-fx-rate-provider';
import { buildFxRateProvider } from './fx-rate-provider.module';

function makeConfig(
  values: Partial<EnvironmentVariables>,
): ConfigService<EnvironmentVariables, true> {
  return {
    get: vi.fn((key: string) => (values as Record<string, unknown>)[key]),
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

describe('buildFxRateProvider (FxRateProviderModule composition)', () => {
  it('binds a FakeFxRateProvider when ALLOW_FAKE_FX_RATE_PROVIDER is explicitly true', () => {
    const provider = buildFxRateProvider(makeConfig({ ALLOW_FAKE_FX_RATE_PROVIDER: true }));

    expect(provider).toBeInstanceOf(FakeFxRateProvider);
  });

  it('fails loudly (throws) when ALLOW_FAKE_FX_RATE_PROVIDER is not set — no real vendor exists to fall back to', () => {
    expect(() => buildFxRateProvider(makeConfig({}))).toThrow(/FX_RATE_PROVIDER/);
  });

  it('fails loudly when ALLOW_FAKE_FX_RATE_PROVIDER is explicitly false', () => {
    expect(() => buildFxRateProvider(makeConfig({ ALLOW_FAKE_FX_RATE_PROVIDER: false }))).toThrow(
      /FX_RATE_PROVIDER/,
    );
  });
});
