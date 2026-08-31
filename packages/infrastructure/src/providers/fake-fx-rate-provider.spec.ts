import { describe, expect, it } from 'vitest';

import { FakeFxRateProvider } from './fake-fx-rate-provider';

describe('FakeFxRateProvider', () => {
  it('returns the default quotes when no step is queued', async () => {
    const provider = new FakeFxRateProvider([{ quoteCurrency: 'USD', rate: '1' }]);

    const result = await provider.fetchRates('UZS', ['USD']);

    expect(result).toEqual([{ quoteCurrency: 'USD', rate: '1' }]);
  });

  it('records the exact call it received, scoped per base currency', async () => {
    const provider = new FakeFxRateProvider();

    await provider.fetchRates('UZS', ['USD', 'EUR']);

    expect(provider.lastCall).toEqual({ baseCurrency: 'UZS', quoteCurrencies: ['USD', 'EUR'] });
    expect(provider.callCount).toBe(1);
  });

  it('consumes scripted steps in order per base currency, then falls back to the default', async () => {
    const provider = new FakeFxRateProvider([{ quoteCurrency: 'USD', rate: 'default' }])
      .enqueue('UZS', { quotes: [{ quoteCurrency: 'USD', rate: 'first' }] })
      .enqueue('UZS', { quotes: [{ quoteCurrency: 'USD', rate: 'second' }] });

    await expect(provider.fetchRates('UZS', ['USD'])).resolves.toEqual([
      { quoteCurrency: 'USD', rate: 'first' },
    ]);
    await expect(provider.fetchRates('UZS', ['USD'])).resolves.toEqual([
      { quoteCurrency: 'USD', rate: 'second' },
    ]);
    await expect(provider.fetchRates('UZS', ['USD'])).resolves.toEqual([
      { quoteCurrency: 'USD', rate: 'default' },
    ]);
  });

  it('scripts for different base currencies never interfere with each other', async () => {
    const provider = new FakeFxRateProvider()
      .enqueue('UZS', { quotes: [{ quoteCurrency: 'USD', rate: 'uzs-rate' }] })
      .enqueue('EUR', { quotes: [{ quoteCurrency: 'USD', rate: 'eur-rate' }] });

    await expect(provider.fetchRates('EUR', ['USD'])).resolves.toEqual([
      { quoteCurrency: 'USD', rate: 'eur-rate' },
    ]);
    await expect(provider.fetchRates('UZS', ['USD'])).resolves.toEqual([
      { quoteCurrency: 'USD', rate: 'uzs-rate' },
    ]);
  });

  it('throws a scripted error', async () => {
    const error = new Error('fake provider outage');
    const provider = new FakeFxRateProvider().enqueue('UZS', { error });

    await expect(provider.fetchRates('UZS', ['USD'])).rejects.toThrow(error);
  });
});
