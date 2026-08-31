import { describe, expect, it } from 'vitest';

import { InvalidFxRateError } from '../errors/invalid-fx-rate.error';
import { validateNewFxRateData } from './validate-new-fx-rate-data';

const NOW = new Date('2026-08-16T12:00:00Z');

function validData() {
  return {
    baseCurrency: 'USD',
    quoteCurrency: 'UZS',
    rate: '12500.50',
    asOfDate: new Date('2026-08-15'),
    source: 'test-provider',
  };
}

describe('validateNewFxRateData', () => {
  it('accepts valid data', () => {
    expect(() => validateNewFxRateData(validData(), NOW)).not.toThrow();
  });

  it('rejects an invalid baseCurrency code', () => {
    expect(() => validateNewFxRateData({ ...validData(), baseCurrency: 'usd' }, NOW)).toThrow(
      InvalidFxRateError,
    );
  });

  it('rejects an invalid quoteCurrency code', () => {
    expect(() => validateNewFxRateData({ ...validData(), quoteCurrency: 'us' }, NOW)).toThrow(
      InvalidFxRateError,
    );
  });

  it('rejects baseCurrency === quoteCurrency (a same-currency rate is never recorded)', () => {
    expect(() =>
      validateNewFxRateData({ ...validData(), baseCurrency: 'USD', quoteCurrency: 'USD' }, NOW),
    ).toThrow(InvalidFxRateError);
  });

  it('rejects a zero or negative rate', () => {
    expect(() => validateNewFxRateData({ ...validData(), rate: '0' }, NOW)).toThrow(
      InvalidFxRateError,
    );
    expect(() => validateNewFxRateData({ ...validData(), rate: '-5' }, NOW)).toThrow(
      InvalidFxRateError,
    );
  });

  it('rejects a malformed rate string', () => {
    expect(() => validateNewFxRateData({ ...validData(), rate: 'abc' }, NOW)).toThrow(
      InvalidFxRateError,
    );
  });

  it('TASK-FIN-008 (precision-bug fix): accepts a full 8-decimal-place rate, matching fx_rates.rate’s own Decimal(18,8) schema precision — previously (incorrectly) rejected by the 2-decimal money validator', () => {
    expect(() => validateNewFxRateData({ ...validData(), rate: '0.12345678' }, NOW)).not.toThrow();
  });

  it('rejects an invalid asOfDate', () => {
    expect(() =>
      validateNewFxRateData({ ...validData(), asOfDate: new Date('invalid') }, NOW),
    ).toThrow(InvalidFxRateError);
  });

  it('rejects an asOfDate in the future', () => {
    expect(() =>
      validateNewFxRateData({ ...validData(), asOfDate: new Date('2026-08-20') }, NOW),
    ).toThrow(InvalidFxRateError);
  });

  it('accepts asOfDate exactly equal to now', () => {
    expect(() => validateNewFxRateData({ ...validData(), asOfDate: NOW }, NOW)).not.toThrow();
  });
});
