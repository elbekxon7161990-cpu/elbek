import { describe, expect, it } from 'vitest';

import { Counterparty, type CounterpartyProps } from './counterparty.entity';
import { InvalidDebtError } from '../errors/invalid-debt.error';

const FIXED_NOW = new Date('2026-08-13T12:00:00Z');

function makeProps(overrides: Partial<CounterpartyProps> = {}): CounterpartyProps {
  return {
    id: 'counterparty-1',
    userId: 'user-1',
    name: 'Aziz',
    aliases: [],
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

describe('Counterparty', () => {
  it('creates a valid counterparty', () => {
    const counterparty = new Counterparty(makeProps());
    expect(counterparty.name).toBe('Aziz');
    expect(counterparty.aliases).toEqual([]);
  });

  it('accepts aliases', () => {
    const counterparty = new Counterparty(makeProps({ aliases: ['Azizbek', 'Aziz-aka'] }));
    expect(counterparty.aliases).toEqual(['Azizbek', 'Aziz-aka']);
  });

  it('rejects a missing id', () => {
    expect(() => new Counterparty(makeProps({ id: '' }))).toThrow(InvalidDebtError);
  });

  it('rejects a missing userId', () => {
    expect(() => new Counterparty(makeProps({ userId: '' }))).toThrow(InvalidDebtError);
  });

  it('rejects a missing/blank name', () => {
    expect(() => new Counterparty(makeProps({ name: '' }))).toThrow(InvalidDebtError);
    expect(() => new Counterparty(makeProps({ name: '   ' }))).toThrow(InvalidDebtError);
  });
});
