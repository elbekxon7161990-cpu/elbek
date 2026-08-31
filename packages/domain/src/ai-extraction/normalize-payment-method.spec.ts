import { describe, expect, it } from 'vitest';

import { PAYMENT_METHODS, normalizePaymentMethod } from './normalize-payment-method';

describe('normalizePaymentMethod', () => {
  it.each(PAYMENT_METHODS)('normalizes the real enum value "%s" uppercased to its canonical lowercase form', (method) => {
    expect(normalizePaymentMethod(method.toUpperCase())).toBe(method);
  });

  it.each(PAYMENT_METHODS)('leaves the already-canonical lowercase value "%s" unchanged', (method) => {
    expect(normalizePaymentMethod(method)).toBe(method);
  });

  it('normalizes a mixed-case real enum value to its canonical lowercase form', () => {
    expect(normalizePaymentMethod('Cash')).toBe('cash');
    expect(normalizePaymentMethod('Bank_Transfer')).toBe('bank_transfer');
    expect(normalizePaymentMethod('MoBiLe_WaLLet')).toBe('mobile_wallet');
  });

  it('rejects a value that is not a real enum value at all, even case-insensitively (no semantic remapping)', () => {
    expect(normalizePaymentMethod('TRANSFER')).toBeNull();
    expect(normalizePaymentMethod('CLICK')).toBeNull();
    expect(normalizePaymentMethod('PAYME')).toBeNull();
    expect(normalizePaymentMethod('BITCOIN')).toBeNull();
    expect(normalizePaymentMethod('UNKNOWN')).toBeNull();
  });

  it('rejects a malformed/empty string', () => {
    expect(normalizePaymentMethod('')).toBeNull();
    expect(normalizePaymentMethod('   ')).toBeNull();
  });

  it('is idempotent — normalizing an already-normalized value changes nothing', () => {
    const once = normalizePaymentMethod('CASH');
    expect(once).not.toBeNull();
    const twice = normalizePaymentMethod(once as string);
    expect(twice).toBe(once);
  });
});
