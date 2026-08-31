import { describe, expect, it } from 'vitest';

import { Account } from './account.entity';
import { InvalidAccountError } from '../errors/invalid-account.error';

function validNewProps() {
  return {
    userId: 'user-1',
    name: 'Cash wallet',
    accountType: 'cash' as const,
    currency: 'UZS',
    startingBalance: '500000.00',
    isDefault: false,
  };
}

function validProps() {
  return {
    id: 'account-1',
    ...validNewProps(),
    status: 'active' as const,
    deletedAt: null,
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
  };
}

describe('Account', () => {
  it('constructs successfully with valid props', () => {
    const account = new Account(validProps());
    expect(account.id).toBe('account-1');
    expect(account.isArchived).toBe(false);
    expect(account.isDeleted).toBe(false);
  });

  it('accepts a negative startingBalance (§8.12.3 — credit-card-style account owed a balance)', () => {
    const account = new Account({ ...validProps(), startingBalance: '-150000.00' });
    expect(account.startingBalance).toBe('-150000.00');
  });

  it('accepts a zero startingBalance', () => {
    const account = new Account({ ...validProps(), startingBalance: '0' });
    expect(account.startingBalance).toBe('0');
  });

  it('rejects an invalid accountType', () => {
    expect(() => new Account({ ...validProps(), accountType: 'crypto' as never })).toThrow(
      InvalidAccountError,
    );
  });

  it('rejects an empty name', () => {
    expect(() => new Account({ ...validProps(), name: '' })).toThrow(InvalidAccountError);
  });

  it('rejects an invalid currency code', () => {
    expect(() => new Account({ ...validProps(), currency: 'usd' })).toThrow(InvalidAccountError);
  });

  it('rejects a malformed startingBalance (not a valid decimal)', () => {
    expect(() => new Account({ ...validProps(), startingBalance: 'abc' })).toThrow(
      InvalidAccountError,
    );
  });

  it('rejects an invalid status', () => {
    expect(() => new Account({ ...validProps(), status: 'closed' as never })).toThrow(
      InvalidAccountError,
    );
  });

  it('isArchived reflects status === "archived"', () => {
    const account = new Account({ ...validProps(), status: 'archived' });
    expect(account.isArchived).toBe(true);
  });

  it('isDeleted reflects a non-null deletedAt', () => {
    const account = new Account({ ...validProps(), deletedAt: new Date('2026-08-10') });
    expect(account.isDeleted).toBe(true);
  });

  describe('validateNew', () => {
    it('accepts a valid not-yet-persisted account', () => {
      expect(() => Account.validateNew(validNewProps())).not.toThrow();
    });

    it('rejects an invalid not-yet-persisted account the same way the constructor would', () => {
      expect(() => Account.validateNew({ ...validNewProps(), currency: 'usd' })).toThrow(
        InvalidAccountError,
      );
    });
  });
});
