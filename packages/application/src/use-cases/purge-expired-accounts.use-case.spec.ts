import { describe, expect, it, vi } from 'vitest';
import type {
  AccountPurgeNotificationQueue,
  AccountPurgeOutcome,
  AccountPurgeRepository,
  User,
  UserRepository,
} from '@afa/domain';

import { PurgeExpiredAccountsUseCase } from './purge-expired-accounts.use-case';

const NOW = new Date('2026-03-01T00:00:00.000Z');

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    telegramUserId: 111n,
    preferredLanguage: 'en',
    status: 'pending_deletion',
    ...overrides,
  } as User;
}

function fakeCounts() {
  return {
    debtRepayments: 0,
    budgetNotificationLog: 0,
    loanPayments: 0,
    transactionAuditLog: 0,
    transactionDrafts: 0,
    scheduledTransactions: 0,
    transactions: 0,
    debts: 0,
    budgets: 0,
    loans: 0,
    accounts: 0,
    savingsGoals: 0,
    counterparties: 0,
    recurringTemplates: 0,
    notifications: 0,
    userSettings: 0,
    userFinancialSummary: 0,
    customCategories: 0,
  };
}

describe('PurgeExpiredAccountsUseCase', () => {
  it('purges every candidate and enqueues one final notification each', async () => {
    const candidates = [
      fakeUser({ id: 'user-1', telegramUserId: 111n }),
      fakeUser({ id: 'user-2', telegramUserId: 222n }),
    ];
    const userRepository = {
      findExpiredPendingDeletions: vi.fn().mockResolvedValue(candidates),
    } as unknown as UserRepository;

    const purgeUser = vi.fn(
      async (candidate: {
        id: string;
        telegramUserId: bigint;
        preferredLanguage: string;
      }): Promise<AccountPurgeOutcome> => ({
        kind: 'purged',
        candidate,
        counts: fakeCounts(),
      }),
    );
    const accountPurgeRepository = { purgeUser } as unknown as AccountPurgeRepository;

    const enqueue = vi.fn().mockResolvedValue(undefined);
    const notificationQueue = { enqueue } as unknown as AccountPurgeNotificationQueue;

    const useCase = new PurgeExpiredAccountsUseCase(
      userRepository,
      accountPurgeRepository,
      notificationQueue,
    );
    const summary = await useCase.execute(NOW);

    expect(summary).toEqual({ candidateCount: 2, purgedCount: 2, storageFailureCount: 0 });
    expect(purgeUser).toHaveBeenCalledTimes(2);
    expect(purgeUser).toHaveBeenCalledWith(
      { id: 'user-1', telegramUserId: 111n, preferredLanguage: 'en' },
      NOW,
    );
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith('111', 'en');
    expect(enqueue).toHaveBeenCalledWith('222', 'en');
  });

  it('does not enqueue a final notification for a storage_failure outcome', async () => {
    const candidates = [fakeUser({ id: 'user-1', telegramUserId: 111n })];
    const userRepository = {
      findExpiredPendingDeletions: vi.fn().mockResolvedValue(candidates),
    } as unknown as UserRepository;

    const purgeUser = vi.fn(
      async (candidate: {
        id: string;
        telegramUserId: bigint;
        preferredLanguage: string;
      }): Promise<AccountPurgeOutcome> => ({
        kind: 'storage_failure',
        candidate,
      }),
    );
    const accountPurgeRepository = { purgeUser } as unknown as AccountPurgeRepository;

    const enqueue = vi.fn().mockResolvedValue(undefined);
    const notificationQueue = { enqueue } as unknown as AccountPurgeNotificationQueue;

    const useCase = new PurgeExpiredAccountsUseCase(
      userRepository,
      accountPurgeRepository,
      notificationQueue,
    );
    const summary = await useCase.execute(NOW);

    expect(summary).toEqual({ candidateCount: 1, purgedCount: 0, storageFailureCount: 1 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns zero counts when there are no expired candidates', async () => {
    const userRepository = {
      findExpiredPendingDeletions: vi.fn().mockResolvedValue([]),
    } as unknown as UserRepository;
    const accountPurgeRepository = { purgeUser: vi.fn() } as unknown as AccountPurgeRepository;
    const notificationQueue = { enqueue: vi.fn() } as unknown as AccountPurgeNotificationQueue;

    const useCase = new PurgeExpiredAccountsUseCase(
      userRepository,
      accountPurgeRepository,
      notificationQueue,
    );
    const summary = await useCase.execute(NOW);

    expect(summary).toEqual({ candidateCount: 0, purgedCount: 0, storageFailureCount: 0 });
    expect(accountPurgeRepository.purgeUser).not.toHaveBeenCalled();
  });

  it('defaults `now` to the current time when omitted', async () => {
    const userRepository = {
      findExpiredPendingDeletions: vi.fn().mockResolvedValue([]),
    } as unknown as UserRepository;
    const accountPurgeRepository = { purgeUser: vi.fn() } as unknown as AccountPurgeRepository;
    const notificationQueue = { enqueue: vi.fn() } as unknown as AccountPurgeNotificationQueue;

    const useCase = new PurgeExpiredAccountsUseCase(
      userRepository,
      accountPurgeRepository,
      notificationQueue,
    );
    await useCase.execute();

    expect(userRepository.findExpiredPendingDeletions).toHaveBeenCalledWith(expect.any(Date));
  });
});
