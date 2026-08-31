import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Account,
  AccountRepository,
  CategoryReference,
  CategoryRepository,
  CommitIdempotencyLockPort,
  CurrencyRepository,
  ExpenseHistoryRepository,
  FxRateRepository,
  TransactionCommitRequest,
  TransactionExtractionCandidate,
  TransactionRepository,
  User,
  UserRepository,
} from '@afa/domain';

import { CreateExpenseUseCase } from './create-expense.use-case';
import { CreateIncomeUseCase } from './create-income.use-case';
import { TransactionCommitAdapter } from './transaction-commit.adapter';

/** Local fake — @afa/application never depends on @afa/infrastructure, even in tests. Mirrors FakeCommitIdempotencyLock's exact semantics. */
class LocalFakeCommitIdempotencyLock implements CommitIdempotencyLockPort {
  private readonly claims = new Map<string, string | null>();
  releaseCalls: string[] = [];
  claimCalls: string[] = [];

  async tryClaim(key: string): Promise<boolean> {
    this.claimCalls.push(key);
    if (this.claims.has(key)) {
      return false;
    }
    this.claims.set(key, null);
    return true;
  }
  async getResult(key: string): Promise<string | null> {
    return this.claims.get(key) ?? null;
  }
  async storeResult(key: string, result: string): Promise<void> {
    this.claims.set(key, result);
  }
  async release(key: string): Promise<void> {
    this.releaseCalls.push(key);
    this.claims.delete(key);
  }
}

class LocalFakeCategoryRepository implements CategoryRepository {
  private readonly byCode = new Map<string, CategoryReference>();
  seed(code: string, ref: CategoryReference): void {
    this.byCode.set(code, ref);
  }
  async findById(id: string): Promise<CategoryReference | null> {
    return [...this.byCode.values()].find((ref) => ref.id === id) ?? null;
  }
  async findByCode(code: string): Promise<CategoryReference | null> {
    return this.byCode.get(code) ?? null;
  }
  // TASK-FIN-006 — Custom Categories additions, unused by this suite (never
  // called by TransactionCommitAdapter); stubbed only to satisfy the
  // interface, matching this fake's own already-minimal, only-what's-needed
  // scope.
  listActiveSystemCategories: CategoryRepository['listActiveSystemCategories'] = async () => [];
  findActiveSystemCategoryByCode: CategoryRepository['findActiveSystemCategoryByCode'] =
    async () => null;
  isDuplicateCategoryName: CategoryRepository['isDuplicateCategoryName'] = async () => false;
  createCustomCategory: CategoryRepository['createCustomCategory'] = async () => {
    throw new Error('LocalFakeCategoryRepository.createCustomCategory is not implemented');
  };
  listCustomCategoriesForUser: CategoryRepository['listCustomCategoriesForUser'] = async () => [];
  findCustomCategoryById: CategoryRepository['findCustomCategoryById'] = async () => null;
  findCategoryLabelById: CategoryRepository['findCategoryLabelById'] = async () => null;
  deleteAndReassignTransactions: CategoryRepository['deleteAndReassignTransactions'] =
    async () => null;
}

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 'user-1', timezone: 'UTC', defaultCurrency: 'UZS', ...overrides } as User;
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'default-account-1',
    userId: 'user-1',
    name: 'Default (UZS)',
    accountType: 'other',
    currency: 'UZS',
    startingBalance: '0',
    isDefault: true,
    status: 'active',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    isArchived: false,
    isDeleted: false,
    ...overrides,
  } as Account;
}

function candidate(
  overrides: Partial<TransactionExtractionCandidate> = {},
): TransactionExtractionCandidate {
  return {
    intent: 'EXPENSE',
    amount: 45000,
    currency: 'UZS',
    category: 'FOOD_DINING',
    subcategory: null,
    merchant: 'Cafe Milano',
    paymentMethod: null,
    transactionDate: '2026-01-15',
    transactionTime: null,
    location: null,
    counterparty: null,
    dueDate: null,
    tags: ['lunch'],
    description: 'Lunch',
    confidenceScores: {
      intent: 0.97,
      amount: 0.95,
      currency: 0.9,
      category: 0.9,
      transactionDate: 0.95,
    },
    ...overrides,
  };
}

function commitRequest(
  overrides: Partial<TransactionCommitRequest> = {},
): TransactionCommitRequest {
  return {
    userId: 'user-1',
    candidate: candidate(),
    draftId: 'draft-1',
    originalText: 'spent 45000 on lunch',
    sourceType: 'text',
    ...overrides,
  };
}

describe('TransactionCommitAdapter', () => {
  let userRepository: { findById: ReturnType<typeof vi.fn> };
  let currencyRepository: { isSupported: ReturnType<typeof vi.fn> };
  let categoryRepository: LocalFakeCategoryRepository;
  let transactionRepository: { create: ReturnType<typeof vi.fn> };
  let expenseHistoryRepository: { getTrailingAverageExpenseAmount: ReturnType<typeof vi.fn> };
  let accountRepository: {
    findById: ReturnType<typeof vi.fn>;
    findOrCreateDefaultForCurrency: ReturnType<typeof vi.fn>;
  };
  let fxRateRepository: { findRate: ReturnType<typeof vi.fn> };
  let idempotencyLock: LocalFakeCommitIdempotencyLock;
  let adapter: TransactionCommitAdapter;

  beforeEach(() => {
    userRepository = { findById: vi.fn().mockResolvedValue(makeUser()) };
    currencyRepository = { isSupported: vi.fn().mockResolvedValue(true) };
    categoryRepository = new LocalFakeCategoryRepository();
    categoryRepository.seed('FOOD_DINING', { id: 'category-food-uuid', status: 'active' });
    transactionRepository = {
      create: vi
        .fn()
        .mockImplementation((data) =>
          Promise.resolve({ id: `txn-${Math.random().toString(36).slice(2)}`, ...data }),
        ),
    };
    expenseHistoryRepository = { getTrailingAverageExpenseAmount: vi.fn().mockResolvedValue(null) };
    accountRepository = {
      findById: vi.fn().mockResolvedValue(makeAccount()),
      findOrCreateDefaultForCurrency: vi.fn().mockResolvedValue(makeAccount()),
    };
    fxRateRepository = {
      findRate: vi.fn().mockResolvedValue({
        rate: '12500.00',
        asOfDate: new Date('2026-01-15'),
        isApproximate: false,
      }),
    };
    idempotencyLock = new LocalFakeCommitIdempotencyLock();

    const createExpense = new CreateExpenseUseCase(
      userRepository as unknown as UserRepository,
      currencyRepository as unknown as CurrencyRepository,
      categoryRepository,
      transactionRepository as unknown as TransactionRepository,
      expenseHistoryRepository as unknown as ExpenseHistoryRepository,
      accountRepository as unknown as AccountRepository,
      fxRateRepository as unknown as FxRateRepository,
    );
    const createIncome = new CreateIncomeUseCase(
      userRepository as unknown as UserRepository,
      currencyRepository as unknown as CurrencyRepository,
      categoryRepository,
      transactionRepository as unknown as TransactionRepository,
      accountRepository as unknown as AccountRepository,
      fxRateRepository as unknown as FxRateRepository,
    );

    adapter = new TransactionCommitAdapter(
      categoryRepository,
      idempotencyLock,
      createExpense,
      createIncome,
    );
  });

  describe('expense commit', () => {
    it('resolves the category code to its UUID and persists an EXPENSE transaction', async () => {
      const result = await adapter.commit(commitRequest());

      expect(result.transactionId).toMatch(/^txn-/);
      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: 'EXPENSE',
          categoryId: 'category-food-uuid',
          amount: '45000.00',
          currency: 'UZS',
        }),
      );
    });

    it('preserves user ownership', async () => {
      await adapter.commit(commitRequest({ userId: 'user-42', candidate: candidate() }));
      userRepository.findById.mockResolvedValueOnce(makeUser({ id: 'user-42' }));

      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-42' }),
      );
    });

    it('preserves currency, date, merchant, and description', async () => {
      await adapter.commit(commitRequest());

      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'UZS',
          transactionDate: new Date('2026-01-15T00:00:00.000Z'),
          merchant: 'Cafe Milano',
          description: 'Lunch',
        }),
      );
    });

    it('preserves source information (originalText, sourceType, sourceReference=draftId) for traceability (Chapter 4 §4.8)', async () => {
      await adapter.commit(
        commitRequest({
          draftId: 'draft-xyz',
          originalText: 'spent 45000 on lunch at Cafe Milano',
        }),
      );

      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          originalText: 'spent 45000 on lunch at Cafe Milano',
          sourceType: 'text',
          sourceReference: 'draft-xyz',
          createdBy: 'ai',
        }),
      );
    });

    it('preserves confidence scores for traceability', async () => {
      await adapter.commit(commitRequest());

      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ confidenceScores: expect.objectContaining({ amount: 0.95 }) }),
      );
    });
  });

  describe('income flow', () => {
    it('commits an INCOME transaction', async () => {
      categoryRepository.seed('SALARY', { id: 'category-salary-uuid', status: 'active' });
      const result = await adapter.commit(
        commitRequest({ candidate: candidate({ intent: 'INCOME', category: 'SALARY' }) }),
      );

      expect(result.transactionId).toMatch(/^txn-/);
      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ transactionType: 'INCOME' }),
      );
    });

    it('commits a SALARY transaction', async () => {
      categoryRepository.seed('SALARY', { id: 'category-salary-uuid', status: 'active' });
      await adapter.commit(
        commitRequest({ candidate: candidate({ intent: 'SALARY', category: 'SALARY' }) }),
      );

      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ transactionType: 'SALARY' }),
      );
    });

    it('commits a REFUND transaction', async () => {
      categoryRepository.seed('SALARY', { id: 'category-salary-uuid', status: 'active' });
      await adapter.commit(
        commitRequest({ candidate: candidate({ intent: 'REFUND', category: 'SALARY' }) }),
      );

      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ transactionType: 'REFUND' }),
      );
    });
  });

  describe('category resolution', () => {
    it('resolves a valid subcategory code to its UUID', async () => {
      categoryRepository.seed('TRANSPORTATION_FUEL', { id: 'subcat-uuid', status: 'active' });

      await adapter.commit(
        commitRequest({ candidate: candidate({ subcategory: 'TRANSPORTATION_FUEL' }) }),
      );

      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ subcategoryId: 'subcat-uuid' }),
      );
    });

    it('drops an unresolvable subcategory code rather than blocking the commit', async () => {
      await adapter.commit(
        commitRequest({ candidate: candidate({ subcategory: 'NOT_A_REAL_CODE' }) }),
      );

      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ subcategoryId: undefined }),
      );
    });

    it('throws CategoryNotFoundError for a category code that does not exist', async () => {
      const { CategoryNotFoundError } = await import('../errors/category-not-found.error');

      await expect(
        adapter.commit(
          commitRequest({ candidate: candidate({ category: 'NOT_A_REAL_CATEGORY' }) }),
        ),
      ).rejects.toBeInstanceOf(CategoryNotFoundError);
      expect(transactionRepository.create).not.toHaveBeenCalled();
    });

    it('throws CategoryNotFoundError for a deprecated category', async () => {
      categoryRepository.seed('OLD_CODE', { id: 'old-uuid', status: 'deprecated' });
      const { CategoryNotFoundError } = await import('../errors/category-not-found.error');

      await expect(
        adapter.commit(commitRequest({ candidate: candidate({ category: 'OLD_CODE' }) })),
      ).rejects.toBeInstanceOf(CategoryNotFoundError);
    });
  });

  describe('incomplete candidate (defense-in-depth — structurally unreachable via BOT-002 but guarded anyway)', () => {
    it('rejects a null amount', async () => {
      const { IncompleteTransactionCandidateError } =
        await import('../errors/incomplete-transaction-candidate.error');

      await expect(
        adapter.commit(commitRequest({ candidate: candidate({ amount: null } as never) })),
      ).rejects.toBeInstanceOf(IncompleteTransactionCandidateError);
    });

    it('rejects a null currency', async () => {
      const { IncompleteTransactionCandidateError } =
        await import('../errors/incomplete-transaction-candidate.error');

      await expect(
        adapter.commit(commitRequest({ candidate: candidate({ currency: null }) })),
      ).rejects.toBeInstanceOf(IncompleteTransactionCandidateError);
    });

    it('rejects a null transactionDate', async () => {
      const { IncompleteTransactionCandidateError } =
        await import('../errors/incomplete-transaction-candidate.error');

      await expect(
        adapter.commit(commitRequest({ candidate: candidate({ transactionDate: null }) })),
      ).rejects.toBeInstanceOf(IncompleteTransactionCandidateError);
    });

    it('rejects a null category', async () => {
      const { IncompleteTransactionCandidateError } =
        await import('../errors/incomplete-transaction-candidate.error');

      await expect(
        adapter.commit(commitRequest({ candidate: candidate({ category: null }) })),
      ).rejects.toBeInstanceOf(IncompleteTransactionCandidateError);
    });
  });

  describe('unsupported transaction intent', () => {
    it('rejects an intent with no supporting use case (e.g. DEBT_GIVEN)', async () => {
      const { UnsupportedTransactionIntentError } =
        await import('../errors/unsupported-transaction-intent.error');

      await expect(
        adapter.commit(
          commitRequest({ candidate: candidate({ intent: 'DEBT_GIVEN', counterparty: 'Aziz' }) }),
        ),
      ).rejects.toBeInstanceOf(UnsupportedTransactionIntentError);
      expect(transactionRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('validation reuse (invalid currency / amount — Chapter 8 domain rules, unchanged from TASK-FIN-001)', () => {
    it('propagates InvalidCurrencyError for an unsupported currency', async () => {
      currencyRepository.isSupported.mockResolvedValue(false);
      const { InvalidCurrencyError } = await import('../errors/invalid-currency.error');

      await expect(adapter.commit(commitRequest())).rejects.toBeInstanceOf(InvalidCurrencyError);
    });

    it('propagates InvalidTransactionError for a non-positive amount', async () => {
      const { InvalidTransactionError } = await import('@afa/domain');

      await expect(
        adapter.commit(commitRequest({ candidate: candidate({ amount: -1 }) })),
      ).rejects.toBeInstanceOf(InvalidTransactionError);
    });
  });

  describe('idempotency', () => {
    it('the same draftId commits exactly once — a second call returns the same transactionId without creating a duplicate', async () => {
      const first = await adapter.commit(commitRequest({ draftId: 'draft-dup' }));
      const second = await adapter.commit(commitRequest({ draftId: 'draft-dup' }));

      expect(second.transactionId).toBe(first.transactionId);
      expect(transactionRepository.create).toHaveBeenCalledTimes(1);
    });

    it('a different draftId for the same user creates a second, distinct transaction (not conflated with the first)', async () => {
      const first = await adapter.commit(commitRequest({ draftId: 'draft-a' }));
      const second = await adapter.commit(commitRequest({ draftId: 'draft-b' }));

      expect(second.transactionId).not.toBe(first.transactionId);
      expect(transactionRepository.create).toHaveBeenCalledTimes(2);
    });

    it('the same draftId for two different users are independent locks (userId is part of the key)', async () => {
      userRepository.findById.mockImplementation((id: string) => Promise.resolve(makeUser({ id })));

      await adapter.commit(commitRequest({ userId: 'user-a', draftId: 'draft-shared' }));
      await adapter.commit(commitRequest({ userId: 'user-b', draftId: 'draft-shared' }));

      expect(transactionRepository.create).toHaveBeenCalledTimes(2);
    });

    it('releases the idempotency claim on failure so a legitimate retry is not permanently blocked', async () => {
      const { CategoryNotFoundError } = await import('../errors/category-not-found.error');
      await expect(
        adapter.commit(
          commitRequest({ draftId: 'draft-retry', candidate: candidate({ category: 'MISSING' }) }),
        ),
      ).rejects.toBeInstanceOf(CategoryNotFoundError);

      expect(idempotencyLock.releaseCalls).toContain('transaction_commit:user-1:draft-retry');

      // A genuine retry (now with a valid category) succeeds.
      const result = await adapter.commit(commitRequest({ draftId: 'draft-retry' }));
      expect(result.transactionId).toMatch(/^txn-/);
    });

    it('concurrent duplicate commits for the same draftId — only one performs the actual persistence', async () => {
      const settled = await Promise.allSettled([
        adapter.commit(commitRequest({ draftId: 'draft-concurrent' })),
        adapter.commit(commitRequest({ draftId: 'draft-concurrent' })),
      ]);

      // Never two created rows, regardless of how the race resolves.
      expect(transactionRepository.create).toHaveBeenCalledTimes(1);

      // The winner (and any loser that read back the already-stored result)
      // resolves with a real transactionId; a loser that raced in before the
      // winner stored its result rejects with TransactionCommitInProgressError
      // rather than silently creating a second transaction — either outcome
      // is acceptable, a second `create` call is not.
      const fulfilled = settled.filter(
        (r): r is PromiseFulfilledResult<{ transactionId: string }> => r.status === 'fulfilled',
      );
      for (const r of fulfilled) {
        expect(r.value.transactionId).toMatch(/^txn-/);
      }
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    });
  });
});
