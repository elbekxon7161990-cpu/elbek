import { describe, expect, it } from 'vitest';

import { Counterparty } from '../entities/counterparty.entity';
import { Debt } from '../entities/debt.entity';
import {
  generateCounterpartyAmbiguityMessage,
  generateNoMatchingDebtMessage,
  generateOverpaymentConfirmationMessage,
  generateRepaymentMatchAmbiguityMessage,
} from './generate-debt-clarification-message';

const FIXED_NOW = new Date('2026-08-13T12:00:00Z');

function makeCounterparty(id: string, name: string): Counterparty {
  return new Counterparty({ id, userId: 'user-1', name, aliases: [], createdAt: FIXED_NOW });
}

function makeDebt(
  overrides: Partial<{ outstandingBalance: string; dueDate: Date | null }> = {},
): Debt {
  return new Debt({
    id: 'debt-1',
    userId: 'user-1',
    direction: 'given',
    counterpartyName: 'Aziz',
    counterpartyRefId: 'c-1',
    originalAmount: '100000',
    outstandingBalance: overrides.outstandingBalance ?? '60000',
    currency: 'UZS',
    transactionDate: new Date('2026-08-01'),
    dueDate: overrides.dueDate === undefined ? new Date('2026-09-01') : overrides.dueDate,
    status: 'open',
    notes: null,
    originalText: 'lent 100000 to Aziz',
    deletedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  });
}

describe('generateCounterpartyAmbiguityMessage', () => {
  it('lists every candidate name, in every language', () => {
    const candidates = [
      makeCounterparty('c-1', 'Aziz Karimov'),
      makeCounterparty('c-2', 'Aziz Yusupov'),
    ];
    for (const language of ['uz', 'ru', 'en'] as const) {
      const message = generateCounterpartyAmbiguityMessage(candidates, language);
      expect(message).toContain('Aziz Karimov');
      expect(message).toContain('Aziz Yusupov');
    }
  });
});

describe('generateRepaymentMatchAmbiguityMessage', () => {
  it('describes every candidate debt with its outstanding balance', () => {
    const candidates = [
      makeDebt({ outstandingBalance: '30000' }),
      makeDebt({ outstandingBalance: '70000' }),
    ];
    const message = generateRepaymentMatchAmbiguityMessage(candidates, 'en');
    expect(message).toContain('30000');
    expect(message).toContain('70000');
  });
});

describe('generateNoMatchingDebtMessage', () => {
  it('names the counterparty in every language', () => {
    for (const language of ['uz', 'ru', 'en'] as const) {
      expect(generateNoMatchingDebtMessage('Aziz', language)).toContain('Aziz');
    }
  });
});

describe('generateOverpaymentConfirmationMessage', () => {
  it('states both the attempted amount and the outstanding balance', () => {
    const message = generateOverpaymentConfirmationMessage('80000', 'UZS', '60000', 'en');
    expect(message).toContain('80000');
    expect(message).toContain('60000');
  });
});
