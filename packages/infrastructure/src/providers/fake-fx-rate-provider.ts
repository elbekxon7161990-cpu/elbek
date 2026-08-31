import type { FxRateProvider, FxRateQuote } from '@afa/domain';

export interface FakeFxRateProviderStep {
  quotes?: FxRateQuote[];
  error?: Error;
}

/**
 * A scriptable `FxRateProvider` test double — NOT a real provider, never
 * wired into any production DI module (`FxRateProviderModule` only binds
 * this when `ALLOW_FAKE_FX_RATE_PROVIDER=true`, an explicit dev-only
 * opt-in). Mirrors `FakeLlmProvider`'s exact scripted-response shape.
 *
 * Scripted responses are consumed per `baseCurrency` in the order enqueued
 * for that base; once a base's script is exhausted, `defaultQuotes` is
 * returned for every subsequent call for that base.
 */
export class FakeFxRateProvider implements FxRateProvider {
  private readonly calls: Array<{ baseCurrency: string; quoteCurrencies: string[] }> = [];
  private readonly scripts = new Map<string, FakeFxRateProviderStep[]>();

  constructor(private readonly defaultQuotes: FxRateQuote[] = []) {}

  enqueue(baseCurrency: string, step: FakeFxRateProviderStep): this {
    const script = this.scripts.get(baseCurrency) ?? [];
    script.push(step);
    this.scripts.set(baseCurrency, script);
    return this;
  }

  async fetchRates(baseCurrency: string, quoteCurrencies: string[]): Promise<FxRateQuote[]> {
    this.calls.push({ baseCurrency, quoteCurrencies });
    const script = this.scripts.get(baseCurrency);
    const next = script?.shift();
    if (next?.error) {
      throw next.error;
    }
    return next?.quotes ?? this.defaultQuotes;
  }

  get callCount(): number {
    return this.calls.length;
  }

  get lastCall(): { baseCurrency: string; quoteCurrencies: string[] } | undefined {
    return this.calls.at(-1);
  }
}
