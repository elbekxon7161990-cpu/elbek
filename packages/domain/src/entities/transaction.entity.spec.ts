import { describe, expect, it } from 'vitest';

import { InvalidTransactionError } from '../errors/invalid-transaction.error';
import { Transaction, type TransactionProps } from './transaction.entity';

const FIXED_NOW = new Date('2026-08-13T12:00:00Z');

function makeProps(overrides: Partial<TransactionProps> = {}): TransactionProps {
  return {
    id: 'txn-1',
    userId: 'user-1',
    transactionType: 'EXPENSE',
    amount: '45000',
    currency: 'UZS',
    exchangeRateToDefault: null,
    accountId: null,
    sourceAccountId: null,
    destinationAccountId: null,
    destinationAmount: null,
    goalId: null,
    categoryId: 'category-food',
    subcategoryId: null,
    merchant: null,
    paymentMethod: null,
    transactionDate: new Date('2026-08-10'),
    transactionTime: null,
    location: null,
    tags: [],
    description: 'Lunch',
    originalText: 'spent 45000 on lunch',
    sourceType: 'text',
    sourceReference: null,
    confidenceScores: null,
    isRecurringDetected: false,
    linkedTransactionId: null,
    createdBy: 'ai',
    deletedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

describe('Transaction', () => {
  it('creates a valid EXPENSE transaction (AC-EXP-001)', () => {
    const txn = new Transaction(makeProps(), FIXED_NOW);

    expect(txn.transactionType).toBe('EXPENSE');
    expect(txn.amount).toBe('45000');
    expect(txn.isDeleted).toBe(false);
  });

  it('creates a valid INCOME transaction (FR-INC-001)', () => {
    const txn = new Transaction(
      makeProps({
        transactionType: 'INCOME',
        categoryId: 'category-freelance',
        description: 'Client payment',
      }),
      FIXED_NOW,
    );

    expect(txn.transactionType).toBe('INCOME');
  });

  it('creates a valid SALARY transaction (FR-INC-002)', () => {
    const txn = new Transaction(
      makeProps({ transactionType: 'SALARY', description: 'Monthly salary' }),
      FIXED_NOW,
    );

    expect(txn.transactionType).toBe('SALARY');
  });

  it('creates a valid REFUND transaction, optionally linked to the original expense (FR-INC-003)', () => {
    const txn = new Transaction(
      makeProps({
        transactionType: 'REFUND',
        linkedTransactionId: 'txn-original',
        description: 'Shoe refund',
      }),
      FIXED_NOW,
    );

    expect(txn.linkedTransactionId).toBe('txn-original');
  });

  it.each(['0', '0.00', '-45000', 'abc', '45000.123'])(
    'rejects an invalid amount "%s" (FR-EXP-002)',
    (amount) => {
      expect(() => new Transaction(makeProps({ amount }), FIXED_NOW)).toThrow(
        InvalidTransactionError,
      );
    },
  );

  it('rejects an invalid transaction type', () => {
    expect(
      () => new Transaction(makeProps({ transactionType: 'NOT_A_TYPE' as never }), FIXED_NOW),
    ).toThrow(InvalidTransactionError);
  });

  it('rejects a future-dated transaction (BR-EXP-002)', () => {
    expect(
      () => new Transaction(makeProps({ transactionDate: new Date('2026-08-14') }), FIXED_NOW),
    ).toThrow(InvalidTransactionError);
  });

  it('accepts a same-day transaction (BR-EXP-002 boundary)', () => {
    expect(
      () => new Transaction(makeProps({ transactionDate: new Date('2026-08-13') }), FIXED_NOW),
    ).not.toThrow();
  });

  describe('BR-EXP-002 — referenceLocalDate (user-timezone-aware future-date check)', () => {
    // FIXED_NOW = 2026-08-13T12:00:00Z. A UTC+9 user's local calendar date
    // at that instant is already 2026-08-14 — a transaction dated
    // 2026-08-14 is "today" for that user, not "the future".
    it('accepts a date that is today in a positive-UTC-offset user timezone, even though it is tomorrow in UTC', () => {
      const userLocalToday = new Date('2026-08-14T00:00:00Z'); // what resolveUserLocalReferenceDate would return for UTC+9
      expect(
        () =>
          new Transaction(
            makeProps({ transactionDate: new Date('2026-08-14') }),
            FIXED_NOW,
            userLocalToday,
          ),
      ).not.toThrow();
    });

    // FIXED_NOW = 2026-08-13T12:00:00Z. A UTC-5 user's local calendar date
    // at that instant is still 2026-08-13 — a transaction dated
    // 2026-08-13 (same as UTC "today") is accepted, matching the default.
    it('accepts a date that is today in a negative-UTC-offset user timezone', () => {
      const userLocalToday = new Date('2026-08-13T00:00:00Z');
      expect(
        () =>
          new Transaction(
            makeProps({ transactionDate: new Date('2026-08-13') }),
            FIXED_NOW,
            userLocalToday,
          ),
      ).not.toThrow();
    });

    it('rejects a date that is still in the future even accounting for the user’s local date', () => {
      const userLocalToday = new Date('2026-08-14T00:00:00Z'); // e.g. a UTC+9 user
      expect(
        () =>
          new Transaction(
            makeProps({ transactionDate: new Date('2026-08-15') }), // still tomorrow for this user
            FIXED_NOW,
            userLocalToday,
          ),
      ).toThrow(InvalidTransactionError);
    });

    it('defaults referenceLocalDate to `now` (UTC) when the caller omits it — unchanged prior behavior', () => {
      expect(
        () => new Transaction(makeProps({ transactionDate: new Date('2026-08-14') }), FIXED_NOW),
      ).toThrow(InvalidTransactionError);
    });

    it('applies referenceLocalDate when re-validating through edit()', () => {
      const txn = new Transaction(makeProps(), FIXED_NOW);
      const userLocalToday = new Date('2026-08-14T00:00:00Z');

      expect(() =>
        txn.edit({ transactionDate: new Date('2026-08-14') }, FIXED_NOW, userLocalToday),
      ).not.toThrow();
      expect(() => txn.edit({ transactionDate: new Date('2026-08-14') }, FIXED_NOW)).toThrow(
        InvalidTransactionError,
      );
    });
  });

  it('rejects missing required fields', () => {
    expect(() => new Transaction(makeProps({ description: '' }), FIXED_NOW)).toThrow(
      InvalidTransactionError,
    );
    expect(() => new Transaction(makeProps({ categoryId: '' }), FIXED_NOW)).toThrow(
      InvalidTransactionError,
    );
    expect(() => new Transaction(makeProps({ originalText: '' }), FIXED_NOW)).toThrow(
      InvalidTransactionError,
    );
  });

  it('accepts a null accountId (FR-FIN-023 — optional)', () => {
    expect(() => new Transaction(makeProps({ accountId: null }), FIXED_NOW)).not.toThrow();
  });

  it('accepts a non-empty accountId', () => {
    const txn = new Transaction(makeProps({ accountId: 'account-1' }), FIXED_NOW);
    expect(txn.accountId).toBe('account-1');
  });

  it('rejects an empty-string accountId', () => {
    expect(() => new Transaction(makeProps({ accountId: '' }), FIXED_NOW)).toThrow(
      InvalidTransactionError,
    );
  });

  it('rejects an invalid currency code', () => {
    expect(() => new Transaction(makeProps({ currency: 'us' }), FIXED_NOW)).toThrow(
      InvalidTransactionError,
    );
  });

  it('rejects an invalid payment method', () => {
    expect(
      () => new Transaction(makeProps({ paymentMethod: 'crypto' as never }), FIXED_NOW),
    ).toThrow(InvalidTransactionError);
  });

  it('soft-deletes and marks isDeleted (FR-EXP-006)', () => {
    const txn = new Transaction(makeProps(), FIXED_NOW);

    const deleted = txn.delete(FIXED_NOW);

    expect(deleted.isDeleted).toBe(true);
    expect(deleted.deletedAt).toEqual(FIXED_NOW);
  });

  it('throws when deleting an already-deleted transaction', () => {
    const deleted = new Transaction(makeProps(), FIXED_NOW).delete(FIXED_NOW);

    expect(() => deleted.delete(FIXED_NOW)).toThrow(InvalidTransactionError);
  });

  it('restores a soft-deleted transaction with all original fields intact (AC-EXP-003)', () => {
    const deleted = new Transaction(makeProps(), FIXED_NOW).delete(FIXED_NOW);

    const restored = deleted.restore(FIXED_NOW);

    expect(restored.isDeleted).toBe(false);
    expect(restored.deletedAt).toBeNull();
    expect(restored.amount).toBe('45000');
    expect(restored.description).toBe('Lunch');
  });

  it('throws when restoring a transaction that is not deleted', () => {
    const txn = new Transaction(makeProps(), FIXED_NOW);

    expect(() => txn.restore(FIXED_NOW)).toThrow(InvalidTransactionError);
  });

  // TASK-FIN-004 Stage A — regression: EXPENSE/INCOME/SALARY/REFUND
  // behavior must be byte-for-byte unchanged by the TRANSFER/
  // GOAL_CONTRIBUTION additions below.
  describe('TASK-FIN-004 regression — existing types reject the new transfer/goal fields', () => {
    it.each(['EXPENSE', 'INCOME', 'SALARY', 'REFUND'] as const)(
      'rejects a %s transaction that sets sourceAccountId',
      (transactionType) => {
        expect(
          () =>
            new Transaction(
              makeProps({ transactionType, sourceAccountId: 'account-1' }),
              FIXED_NOW,
            ),
        ).toThrow(InvalidTransactionError);
      },
    );

    it.each(['EXPENSE', 'INCOME', 'SALARY', 'REFUND'] as const)(
      'rejects a %s transaction that sets destinationAccountId',
      (transactionType) => {
        expect(
          () =>
            new Transaction(
              makeProps({ transactionType, destinationAccountId: 'account-2' }),
              FIXED_NOW,
            ),
        ).toThrow(InvalidTransactionError);
      },
    );

    it.each(['EXPENSE', 'INCOME', 'SALARY', 'REFUND'] as const)(
      'rejects a %s transaction that sets destinationAmount',
      (transactionType) => {
        expect(
          () =>
            new Transaction(makeProps({ transactionType, destinationAmount: '100.00' }), FIXED_NOW),
        ).toThrow(InvalidTransactionError);
      },
    );

    it.each(['EXPENSE', 'INCOME', 'SALARY', 'REFUND'] as const)(
      'rejects a %s transaction that sets goalId',
      (transactionType) => {
        expect(
          () => new Transaction(makeProps({ transactionType, goalId: 'goal-1' }), FIXED_NOW),
        ).toThrow(InvalidTransactionError);
      },
    );

    it('still accepts a plain EXPENSE with every new field left null (unchanged default shape)', () => {
      expect(() => new Transaction(makeProps(), FIXED_NOW)).not.toThrow();
    });
  });

  describe('TASK-FIN-004 (FR-FIN-004/005/006, §8.7) — TRANSFER', () => {
    function makeTransferProps(overrides: Partial<TransactionProps> = {}): TransactionProps {
      return makeProps({
        transactionType: 'TRANSFER',
        accountId: null,
        sourceAccountId: 'account-cash',
        destinationAccountId: 'account-bank',
        description: 'Move cash to bank',
        originalText: 'moved 45000 from cash to bank',
        ...overrides,
      });
    }

    it('creates a valid same-currency TRANSFER (AC-FIN-002)', () => {
      const txn = new Transaction(makeTransferProps(), FIXED_NOW);

      expect(txn.transactionType).toBe('TRANSFER');
      expect(txn.sourceAccountId).toBe('account-cash');
      expect(txn.destinationAccountId).toBe('account-bank');
      expect(txn.accountId).toBeNull();
    });

    it('creates a valid cross-currency TRANSFER with destinationAmount populated (FR-FIN-005)', () => {
      const txn = new Transaction(makeTransferProps({ destinationAmount: '4.10' }), FIXED_NOW);

      expect(txn.destinationAmount).toBe('4.10');
    });

    it('rejects a TRANSFER missing sourceAccountId', () => {
      expect(
        () => new Transaction(makeTransferProps({ sourceAccountId: null }), FIXED_NOW),
      ).toThrow(InvalidTransactionError);
    });

    it('rejects a TRANSFER missing destinationAccountId', () => {
      expect(
        () => new Transaction(makeTransferProps({ destinationAccountId: null }), FIXED_NOW),
      ).toThrow(InvalidTransactionError);
    });

    it('rejects a TRANSFER using the same account as source and destination (§8.7.5, AC-FIN-007)', () => {
      expect(
        () =>
          new Transaction(
            makeTransferProps({
              sourceAccountId: 'account-cash',
              destinationAccountId: 'account-cash',
            }),
            FIXED_NOW,
          ),
      ).toThrow(InvalidTransactionError);
    });

    it('rejects a TRANSFER that also sets accountId', () => {
      expect(
        () => new Transaction(makeTransferProps({ accountId: 'account-cash' }), FIXED_NOW),
      ).toThrow(InvalidTransactionError);
    });

    it('rejects a TRANSFER with an invalid destinationAmount', () => {
      expect(
        () => new Transaction(makeTransferProps({ destinationAmount: '-5' }), FIXED_NOW),
      ).toThrow(InvalidTransactionError);
    });

    it('accepts a TRANSFER optionally linked to a savings goal (approved "linked transfer" contribution mode, FR-FIN-012)', () => {
      const txn = new Transaction(makeTransferProps({ goalId: 'goal-1' }), FIXED_NOW);

      expect(txn.goalId).toBe('goal-1');
    });

    it('still requires categoryId on a TRANSFER (unchanged NOT NULL categoryId invariant)', () => {
      expect(() => new Transaction(makeTransferProps({ categoryId: '' }), FIXED_NOW)).toThrow(
        InvalidTransactionError,
      );
    });

    describe('TASK-FIN-004 (FR-FIN-006) — edit()', () => {
      it('allows editing amount alone on a same-currency TRANSFER', () => {
        const txn = new Transaction(makeTransferProps(), FIXED_NOW);

        const edited = txn.edit({ amount: '60000' }, FIXED_NOW);

        expect(edited.amount).toBe('60000');
        expect(edited.sourceAccountId).toBe('account-cash');
        expect(edited.destinationAccountId).toBe('account-bank');
      });

      it('allows editing amount together with a re-stated destinationAmount on a cross-currency TRANSFER', () => {
        const txn = new Transaction(
          makeTransferProps({ currency: 'USD', destinationAmount: '4.10' }),
          FIXED_NOW,
        );

        const edited = txn.edit({ amount: '55', destinationAmount: '4.50' }, FIXED_NOW);

        expect(edited.amount).toBe('55');
        expect(edited.destinationAmount).toBe('4.50');
      });

      it('allows clearing destinationAmount together with a currency edit', () => {
        const txn = new Transaction(
          makeTransferProps({ currency: 'USD', destinationAmount: '4.10' }),
          FIXED_NOW,
        );

        const edited = txn.edit({ currency: 'UZS', destinationAmount: null }, FIXED_NOW);

        expect(edited.currency).toBe('UZS');
        expect(edited.destinationAmount).toBeNull();
      });

      it('rejects editing destinationAmount without also editing amount or currency', () => {
        const txn = new Transaction(
          makeTransferProps({ currency: 'USD', destinationAmount: '4.10' }),
          FIXED_NOW,
        );

        expect(() => txn.edit({ destinationAmount: '5.00' }, FIXED_NOW)).toThrow(
          InvalidTransactionError,
        );
      });

      it('rejects clearing destinationAmount without also editing amount or currency', () => {
        const txn = new Transaction(
          makeTransferProps({ currency: 'USD', destinationAmount: '4.10' }),
          FIXED_NOW,
        );

        expect(() => txn.edit({ destinationAmount: null }, FIXED_NOW)).toThrow(
          InvalidTransactionError,
        );
      });

      it('leaves sourceAccountId/destinationAccountId unchanged — they are not part of TransactionEditableFields', () => {
        const txn = new Transaction(makeTransferProps(), FIXED_NOW);

        const edited = txn.edit({ description: 'Corrected note' }, FIXED_NOW);

        expect(edited.sourceAccountId).toBe('account-cash');
        expect(edited.destinationAccountId).toBe('account-bank');
      });

      it('rejects editing a goal-linked TRANSFER', () => {
        const txn = new Transaction(makeTransferProps({ goalId: 'goal-1' }), FIXED_NOW);

        expect(() => txn.edit({ amount: '60000' }, FIXED_NOW)).toThrow(InvalidTransactionError);
      });

      it('still allows editing a non-goal-linked TRANSFER', () => {
        const txn = new Transaction(makeTransferProps({ goalId: null }), FIXED_NOW);

        expect(() => txn.edit({ amount: '60000' }, FIXED_NOW)).not.toThrow();
      });
    });
  });

  describe('TASK-FIN-004 (FR-FIN-011/012, §8.9) — GOAL_CONTRIBUTION', () => {
    function makeGoalContributionProps(
      overrides: Partial<TransactionProps> = {},
    ): TransactionProps {
      return makeProps({
        transactionType: 'GOAL_CONTRIBUTION',
        goalId: 'goal-1',
        description: 'Contribution toward vacation fund',
        originalText: 'put aside 50000 for vacation',
        ...overrides,
      });
    }

    it('creates a valid standalone GOAL_CONTRIBUTION (AC-FIN-004)', () => {
      const txn = new Transaction(makeGoalContributionProps(), FIXED_NOW);

      expect(txn.transactionType).toBe('GOAL_CONTRIBUTION');
      expect(txn.goalId).toBe('goal-1');
    });

    it('rejects a GOAL_CONTRIBUTION missing goalId', () => {
      expect(() => new Transaction(makeGoalContributionProps({ goalId: null }), FIXED_NOW)).toThrow(
        InvalidTransactionError,
      );
    });

    it('rejects a GOAL_CONTRIBUTION that also sets sourceAccountId/destinationAccountId', () => {
      expect(
        () =>
          new Transaction(
            makeGoalContributionProps({ sourceAccountId: 'account-cash' }),
            FIXED_NOW,
          ),
      ).toThrow(InvalidTransactionError);
      expect(
        () =>
          new Transaction(
            makeGoalContributionProps({ destinationAccountId: 'account-bank' }),
            FIXED_NOW,
          ),
      ).toThrow(InvalidTransactionError);
    });

    it('accepts an optional accountId on a GOAL_CONTRIBUTION (attribution only, FR-FIN-023 generalization)', () => {
      const txn = new Transaction(
        makeGoalContributionProps({ accountId: 'account-cash' }),
        FIXED_NOW,
      );

      expect(txn.accountId).toBe('account-cash');
    });
  });
});
