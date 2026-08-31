import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ContributeToSavingsGoalUseCase,
  CreateLoanUseCase,
  CreateSavingsGoalUseCase,
  CreateTransferUseCase,
  DeleteTransactionUseCase,
  EditTransactionUseCase,
  ListOpenLoansUseCase,
} from '@afa/application';
import {
  GoalLinkedTransferDeleteNotSupportedError,
  InvalidDestinationAmountEditError,
  MissingDestinationAmountError,
  UnauthorizedAccountAccessError,
  UnauthorizedTransactionAccessError,
} from '@afa/application';
import { InvalidTransactionError, subtractDecimalAmounts } from '@afa/domain';
import { runWithUserContext } from '@afa/shared';
import {
  PrismaAccountRepository,
  PrismaCategoryRepository,
  PrismaCurrencyRepository,
  PrismaFxRateRepository,
  PrismaLoanRepository,
  PrismaSavingsGoalRepository,
  PrismaService,
  PrismaTransactionAuditLogRepository,
  PrismaTransactionRepository,
  PrismaUserRepository,
} from '@afa/infrastructure';

/**
 * TASK-FIN-004 Stage D — "Transaction/account integration". Per this
 * task's own original A→J plan, Stage D wires the Stage C use-cases
 * against the REAL Stage B repository implementations end to end (real
 * Postgres, no mocks) — the one layer no prior stage actually proved
 * together: Stage B tested `PrismaTransactionRepository`/`PrismaLoanRepository`/
 * `PrismaSavingsGoalRepository` directly (bypassing the use-case layer's
 * ownership/business-rule checks entirely); Stage C unit-tested the
 * use-cases with mocked repositories (bypassing real Postgres, real FK
 * constraints, and real RLS-adjacent wiring entirely). Neither proved the
 * two layers actually compose correctly. This file is that proof, mirroring
 * `scenario-d-multi-currency.integration.spec.ts`'s own "construct real
 * repos, drive real use cases" convention exactly.
 *
 * Also serves as the disclosed, explicit real-Postgres proof of
 * TASK-FIN-004 Stage G's own correction to `compute-account-balance.ts`
 * (§8.14.2, AC-FIN-002, FR-FIN-006): a TRANSFER now moves both accounts'
 * computed balances (transfer-in/transfer-out), while a standalone
 * GOAL_CONTRIBUTION's deliberate NON-effect (BR-FIN-003) remains
 * unchanged. `DEBT_*`/`LOAN_PAYMENT` inflows/outflows named in §8.14.2's
 * prose remain explicitly OUT of Stage G's scope (a separate, not-yet-
 * scoped future stage) — not proven or disproven here.
 */
process.env.DATABASE_URL ??=
  'postgresql://afa_owner:local_dev_only@localhost:5432/afa?schema=public';

const OWNER_DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const UZS = 'UZS';
const USD = 'USD';

describe('TASK-FIN-004 Stage D — CreateTransferUseCase (real Postgres, end-to-end)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const userRepository = new PrismaUserRepository(prisma);
  const currencyRepository = new PrismaCurrencyRepository(prisma);
  const categoryRepository = new PrismaCategoryRepository(prisma, prisma);
  const accountRepository = new PrismaAccountRepository(prisma);
  const savingsGoalRepository = new PrismaSavingsGoalRepository(prisma);
  const fxRateRepository = new PrismaFxRateRepository(prisma);
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);

  const createTransfer = new CreateTransferUseCase(
    userRepository,
    currencyRepository,
    categoryRepository,
    accountRepository,
    savingsGoalRepository,
    fxRateRepository,
    transactionRepository,
  );

  const TELEGRAM_USER_ID_A = 900_000_000_950n;
  const TELEGRAM_USER_ID_B = 900_000_000_951n;
  let userAId: string;
  let userBId: string;
  let cashAccountId: string;
  let bankAccountId: string;
  let usdAccountId: string;
  let userBAccountId: string;
  let goalId: string;
  let createdTransactionIds: string[] = [];

  function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();

    const userA = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_A },
      create: {
        telegramUserId: TELEGRAM_USER_ID_A,
        displayName: 'TASK-FIN-004 Stage D Transfer Test A',
        timezone: 'UTC',
        defaultCurrency: UZS,
      },
      update: { timezone: 'UTC', status: 'active', defaultCurrency: UZS },
    });
    userAId = userA.id;

    const userB = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_B },
      create: {
        telegramUserId: TELEGRAM_USER_ID_B,
        displayName: 'TASK-FIN-004 Stage D Transfer Test B',
        timezone: 'UTC',
        defaultCurrency: UZS,
      },
      update: { timezone: 'UTC', status: 'active', defaultCurrency: UZS },
    });
    userBId = userB.id;

    const cashAccount = await accountRepository.create({
      userId: userAId,
      name: 'Cash',
      accountType: 'cash',
      currency: UZS,
      startingBalance: '500000.00',
      isDefault: false,
    });
    cashAccountId = cashAccount.id;

    const bankAccount = await accountRepository.create({
      userId: userAId,
      name: 'Bank Card',
      accountType: 'bank_card',
      currency: UZS,
      startingBalance: '0.00',
      isDefault: false,
    });
    bankAccountId = bankAccount.id;

    const usdAccount = await accountRepository.create({
      userId: userAId,
      name: 'USD Savings',
      accountType: 'savings',
      currency: USD,
      startingBalance: '0.00',
      isDefault: false,
    });
    usdAccountId = usdAccount.id;

    const userBAccount = await accountRepository.create({
      userId: userBId,
      name: "B's Cash",
      accountType: 'cash',
      currency: UZS,
      startingBalance: '0.00',
      isDefault: false,
    });
    userBAccountId = userBAccount.id;

    const goal = await savingsGoalRepository.create({
      userId: userAId,
      name: 'Vacation fund',
      targetAmount: '5000000.00',
      currency: UZS,
      targetDate: null,
    });
    goalId = goal.id;
    // No FxRateRepository seed needed: every transfer test below uses a
    // UZS source account against a UZS-default-currency user (same-currency
    // shortcut, exchangeRateToDefault implicitly '1' — see
    // `resolveTransactionExchangeRate`'s own established rule), and the one
    // cross-currency test supplies `destinationAmount` directly (Stage C's
    // user-supplied-only design) — no `FxRateRepository.findRate()` call is
    // ever reached by this describe block.
  });

  afterEach(async () => {
    if (createdTransactionIds.length > 0) {
      await prisma.transaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
    }
    createdTransactionIds = [];
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.savingsGoal.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.account.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    // Defensive: this environment is a shared, persistent Supabase instance
    // (not a fresh local Postgres) — a `telegram_user_id` this suite picks
    // could coincide with a pre-existing row from unrelated historical
    // testing that already has dependent `notifications` rows, which would
    // otherwise block the final `user.deleteMany()` below via its own FK.
    await prisma.notification.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.onModuleDestroy();
  });

  it('A — a same-currency transfer persists end to end AND moves both accounts’ computed balances (AC-FIN-002, Stage G)', async () => {
    const balanceBeforeCash = await as(userAId, () =>
      accountRepository.computeBalance(cashAccountId, userAId, new Date('2026-08-17')),
    );
    const balanceBeforeBank = await as(userAId, () =>
      accountRepository.computeBalance(bankAccountId, userAId, new Date('2026-08-17')),
    );

    const transfer = await as(userAId, () =>
      createTransfer.execute({
        userId: userAId,
        sourceAccountId: cashAccountId,
        destinationAccountId: bankAccountId,
        amount: '45000.00',
        transactionDate: new Date('2026-08-17'),
        description: 'Move cash to bank',
        originalText: `moved 45000 from cash to bank ${randomUUID()}`,
        sourceType: 'manual',
        createdBy: 'user_manual',
      }),
    );
    createdTransactionIds.push(transfer.id);

    expect(transfer.transactionType).toBe('TRANSFER');
    expect(transfer.sourceAccountId).toBe(cashAccountId);
    expect(transfer.destinationAccountId).toBe(bankAccountId);

    const found = await transactionRepository.findById(transfer.id);
    expect(found?.currency).toBe(UZS);

    // AC-FIN-002: the source account decreases and the destination account
    // increases by exactly the transferred amount — computed relative to
    // the measured "before" balances rather than hardcoded literals, so
    // this assertion is robust regardless of suite ordering.
    const balanceAfterCash = await as(userAId, () =>
      accountRepository.computeBalance(cashAccountId, userAId, new Date('2026-08-17')),
    );
    const balanceAfterBank = await as(userAId, () =>
      accountRepository.computeBalance(bankAccountId, userAId, new Date('2026-08-17')),
    );
    expect(balanceAfterCash).toBe(subtractDecimalAmounts(balanceBeforeCash!, '45000.00'));
    expect(balanceAfterBank).toBe(subtractDecimalAmounts(balanceBeforeBank!, '-45000.00'));
  }, 15_000);

  it('B — a cross-currency transfer with a supplied destinationAmount persists end to end (FR-FIN-005)', async () => {
    const transfer = await as(userAId, () =>
      createTransfer.execute({
        userId: userAId,
        sourceAccountId: cashAccountId,
        destinationAccountId: usdAccountId,
        amount: '1000000.00',
        destinationAmount: '81.00',
        transactionDate: new Date('2026-08-17'),
        description: 'Move UZS cash to USD savings',
        originalText: `moved 1000000 UZS to USD savings ${randomUUID()}`,
        sourceType: 'manual',
        createdBy: 'user_manual',
      }),
    );
    createdTransactionIds.push(transfer.id);

    const found = await transactionRepository.findById(transfer.id);
    expect(found?.destinationAmount).toBe('81.00');
    expect(found?.exchangeRateToDefault).not.toBeNull();
  });

  it('C — a cross-currency transfer WITHOUT a supplied destinationAmount is rejected end to end, zero rows persisted (Stage C scope decision)', async () => {
    const originalText = `missing-dest-amount-${randomUUID()}`;

    await expect(
      as(userAId, () =>
        createTransfer.execute({
          userId: userAId,
          sourceAccountId: cashAccountId,
          destinationAccountId: usdAccountId,
          amount: '1000000.00',
          transactionDate: new Date('2026-08-17'),
          description: 'Invalid cross-currency transfer',
          originalText,
          sourceType: 'manual',
          createdBy: 'user_manual',
        }),
      ),
    ).rejects.toThrow(MissingDestinationAmountError);

    const rows = await prisma.transaction.findMany({ where: { originalText } });
    expect(rows).toHaveLength(0);
  });

  it('D — rejects a same-account transfer end to end, zero rows persisted (§8.7.5, AC-FIN-007)', async () => {
    const originalText = `same-account-${randomUUID()}`;

    await expect(
      as(userAId, () =>
        createTransfer.execute({
          userId: userAId,
          sourceAccountId: cashAccountId,
          destinationAccountId: cashAccountId,
          amount: '1000.00',
          transactionDate: new Date('2026-08-17'),
          description: 'Invalid self-transfer',
          originalText,
          sourceType: 'manual',
          createdBy: 'user_manual',
        }),
      ),
    ).rejects.toThrow(InvalidTransactionError);

    const rows = await prisma.transaction.findMany({ where: { originalText } });
    expect(rows).toHaveLength(0);
  });

  it("E — rejects a transfer into another user's account end to end (ownership enforcement, two-layer: application + repository)", async () => {
    const originalText = `cross-user-${randomUUID()}`;

    await expect(
      as(userAId, () =>
        createTransfer.execute({
          userId: userAId,
          sourceAccountId: cashAccountId,
          destinationAccountId: userBAccountId,
          amount: '1000.00',
          transactionDate: new Date('2026-08-17'),
          description: 'Invalid cross-user transfer',
          originalText,
          sourceType: 'manual',
          createdBy: 'user_manual',
        }),
      ),
    ).rejects.toThrow(UnauthorizedAccountAccessError);

    const rows = await prisma.transaction.findMany({ where: { originalText } });
    expect(rows).toHaveLength(0);
  });

  it('F — persists a TRANSFER linked to a real savings goal end to end; Stage E’s own progress/milestone hook now runs (built since this test was first written) but a 300,000/5,000,000 (6%) transfer crosses no threshold, so the goal’s own row is correctly unchanged', async () => {
    const transfer = await as(userAId, () =>
      createTransfer.execute({
        userId: userAId,
        sourceAccountId: cashAccountId,
        destinationAccountId: bankAccountId,
        goalId,
        amount: '300000.00',
        transactionDate: new Date('2026-08-17'),
        description: 'Transfer linked to vacation fund',
        originalText: `linked transfer ${randomUUID()}`,
        sourceType: 'manual',
        createdBy: 'user_manual',
      }),
    );
    createdTransactionIds.push(transfer.id);

    expect(transfer.goalId).toBe(goalId);

    const goalRow = await as(userAId, () => savingsGoalRepository.findById(goalId));
    expect(goalRow?.lastMilestoneFired).toBeNull();
    expect(goalRow?.status).toBe('active');
  }, 15_000);
});

describe('TASK-FIN-004 Stage D — SavingsGoal use-cases (real Postgres, end-to-end)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const userRepository = new PrismaUserRepository(prisma);
  const currencyRepository = new PrismaCurrencyRepository(prisma);
  const categoryRepository = new PrismaCategoryRepository(prisma, prisma);
  const accountRepository = new PrismaAccountRepository(prisma);
  const savingsGoalRepository = new PrismaSavingsGoalRepository(prisma);
  const fxRateRepository = new PrismaFxRateRepository(prisma);
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);

  const createSavingsGoal = new CreateSavingsGoalUseCase(
    userRepository,
    currencyRepository,
    savingsGoalRepository,
  );
  const contributeToSavingsGoal = new ContributeToSavingsGoalUseCase(
    userRepository,
    currencyRepository,
    categoryRepository,
    savingsGoalRepository,
    accountRepository,
    fxRateRepository,
    transactionRepository,
  );

  const TELEGRAM_USER_ID_C = 900_000_000_952n;
  const TELEGRAM_USER_ID_D = 900_000_000_953n;
  let userCId: string;
  let userDId: string;
  let accountId: string;
  let createdGoalIds: string[] = [];
  let createdTransactionIds: string[] = [];

  function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();

    const userC = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_C },
      create: {
        telegramUserId: TELEGRAM_USER_ID_C,
        displayName: 'TASK-FIN-004 Stage D Goal Test C',
        timezone: 'UTC',
        defaultCurrency: UZS,
      },
      update: { timezone: 'UTC', status: 'active', defaultCurrency: UZS },
    });
    userCId = userC.id;

    const userD = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_D },
      create: {
        telegramUserId: TELEGRAM_USER_ID_D,
        displayName: 'TASK-FIN-004 Stage D Goal Test D',
        timezone: 'UTC',
        defaultCurrency: UZS,
      },
      update: { timezone: 'UTC', status: 'active', defaultCurrency: UZS },
    });
    userDId = userD.id;

    const account = await accountRepository.create({
      userId: userCId,
      name: 'Cash',
      accountType: 'cash',
      currency: UZS,
      startingBalance: '1000000.00',
      isDefault: false,
    });
    accountId = account.id;
  });

  afterEach(async () => {
    if (createdTransactionIds.length > 0) {
      await prisma.transaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
    }
    if (createdGoalIds.length > 0) {
      await prisma.savingsGoal.deleteMany({ where: { id: { in: createdGoalIds } } });
    }
    createdTransactionIds = [];
    createdGoalIds = [];
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { userId: { in: [userCId, userDId] } } });
    await prisma.savingsGoal.deleteMany({ where: { userId: { in: [userCId, userDId] } } });
    await prisma.account.deleteMany({ where: { userId: userCId } });
    await prisma.notification.deleteMany({ where: { userId: { in: [userCId, userDId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userCId, userDId] } } });
    await prisma.onModuleDestroy();
  });

  it('A — creates a savings goal end to end (FR-FIN-011)', async () => {
    const goal = await as(userCId, () =>
      createSavingsGoal.execute({
        userId: userCId,
        name: 'New laptop',
        targetAmount: '8000000.00',
        currency: UZS,
      }),
    );
    createdGoalIds.push(goal.id);

    expect(goal.status).toBe('active');
    const found = await as(userCId, () => savingsGoalRepository.findById(goal.id));
    expect(found?.name).toBe('New laptop');
  });

  it('B — a standalone GOAL_CONTRIBUTION persists end to end AND does NOT change the attributed account’s computed balance (BR-FIN-003)', async () => {
    const goal = await as(userCId, () =>
      createSavingsGoal.execute({
        userId: userCId,
        name: 'Emergency fund',
        targetAmount: '2000000.00',
        currency: UZS,
      }),
    );
    createdGoalIds.push(goal.id);

    const balanceBefore = await as(userCId, () =>
      accountRepository.computeBalance(accountId, userCId, new Date('2026-08-17')),
    );

    const contribution = await as(userCId, () =>
      contributeToSavingsGoal.execute({
        userId: userCId,
        goalId: goal.id,
        accountId,
        amount: '250000.00',
        currency: UZS,
        transactionDate: new Date('2026-08-17'),
        description: 'Contribution toward emergency fund',
        originalText: `contribution ${randomUUID()}`,
        sourceType: 'manual',
        createdBy: 'user_manual',
      }),
    );
    createdTransactionIds.push(contribution.id);

    expect(contribution.transactionType).toBe('GOAL_CONTRIBUTION');
    expect(contribution.goalId).toBe(goal.id);
    expect(contribution.accountId).toBe(accountId);
    expect(contribution.sourceAccountId).toBeNull();
    expect(contribution.destinationAccountId).toBeNull();

    // BR-FIN-003 — "has not left the user's net worth, only been
    // earmarked": Stage G's TRANSFER correction to `compute-account-balance.ts`
    // left this proof intact — GOAL_CONTRIBUTION is still not one of the
    // transaction_type values the formula sums over.
    const balanceAfter = await as(userCId, () =>
      accountRepository.computeBalance(accountId, userCId, new Date('2026-08-17')),
    );
    expect(balanceAfter).toBe(balanceBefore);
  }, 15_000);

  it('C — rejects a contribution to a nonexistent goal end to end', async () => {
    const originalText = `missing-goal-${randomUUID()}`;

    await expect(
      as(userCId, () =>
        contributeToSavingsGoal.execute({
          userId: userCId,
          goalId: randomUUID(),
          amount: '10000.00',
          currency: UZS,
          transactionDate: new Date('2026-08-17'),
          description: 'Invalid contribution',
          originalText,
          sourceType: 'manual',
          createdBy: 'user_manual',
        }),
      ),
    ).rejects.toThrow();

    const rows = await prisma.transaction.findMany({ where: { originalText } });
    expect(rows).toHaveLength(0);
  });

  it("D — rejects a contribution to another user's goal end to end (ownership enforcement)", async () => {
    const goal = await as(userCId, () =>
      createSavingsGoal.execute({
        userId: userCId,
        name: "C's private goal",
        targetAmount: '1000000.00',
        currency: UZS,
      }),
    );
    createdGoalIds.push(goal.id);
    const originalText = `cross-user-goal-${randomUUID()}`;

    await expect(
      as(userDId, () =>
        contributeToSavingsGoal.execute({
          userId: userDId,
          goalId: goal.id,
          amount: '10000.00',
          currency: UZS,
          transactionDate: new Date('2026-08-17'),
          description: "Invalid contribution to C's goal",
          originalText,
          sourceType: 'manual',
          createdBy: 'user_manual',
        }),
      ),
    ).rejects.toThrow();

    const rows = await prisma.transaction.findMany({ where: { originalText } });
    expect(rows).toHaveLength(0);
  });
});

describe('TASK-FIN-004 Stage D — Loan use-cases (real Postgres, end-to-end)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const userRepository = new PrismaUserRepository(prisma);
  const currencyRepository = new PrismaCurrencyRepository(prisma);
  const loanRepository = new PrismaLoanRepository(prisma, prisma);

  const createLoan = new CreateLoanUseCase(userRepository, currencyRepository, loanRepository);
  const listOpenLoans = new ListOpenLoansUseCase(loanRepository);

  const TELEGRAM_USER_ID_E = 900_000_000_954n;
  const TELEGRAM_USER_ID_F = 900_000_000_955n;
  let userEId: string;
  let userFId: string;
  let createdLoanIds: string[] = [];

  function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();

    const userE = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_E },
      create: {
        telegramUserId: TELEGRAM_USER_ID_E,
        displayName: 'TASK-FIN-004 Stage D Loan Test E',
      },
      update: {},
    });
    userEId = userE.id;

    const userF = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_F },
      create: {
        telegramUserId: TELEGRAM_USER_ID_F,
        displayName: 'TASK-FIN-004 Stage D Loan Test F',
      },
      update: {},
    });
    userFId = userF.id;
  });

  afterEach(async () => {
    if (createdLoanIds.length > 0) {
      await prisma.loan.deleteMany({ where: { id: { in: createdLoanIds } } });
    }
    createdLoanIds = [];
  });

  afterAll(async () => {
    await prisma.loan.deleteMany({ where: { userId: { in: [userEId, userFId] } } });
    await prisma.notification.deleteMany({ where: { userId: { in: [userEId, userFId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userEId, userFId] } } });
    await prisma.onModuleDestroy();
  });

  it('A — creates a loan end to end and it is listed by ListOpenLoansUseCase, scoped to the owning user (FR-FIN-007/009)', async () => {
    const loan = await as(userEId, () =>
      createLoan.execute({
        userId: userEId,
        lender: 'Ipoteka Bank',
        principalAmount: '1000000.00',
        currency: UZS,
        interestRate: '0.1200',
        installmentAmount: '90000.00',
        installmentFrequency: 'monthly',
        startDate: new Date('2026-08-01'),
      }),
    );
    createdLoanIds.push(loan.id);

    const openForE = await as(userEId, () => listOpenLoans.execute({ userId: userEId }));
    const openForF = await as(userFId, () => listOpenLoans.execute({ userId: userFId }));

    expect(openForE.map((l) => l.id)).toContain(loan.id);
    expect(openForF.map((l) => l.id)).not.toContain(loan.id);
  });
});

/**
 * TASK-FIN-004 (FR-FIN-006) — real-Postgres, end-to-end proof that editing/
 * deleting a TRANSFER keeps both accounts' balances symmetrically correct,
 * enforces the three approved product decisions (amount/currency editable
 * with a mandatory co-required destinationAmount on a cross-currency
 * conversion change; sourceAccountId/destinationAccountId/destinationAmount
 * otherwise immutable; goal-linked TRANSFER edit/delete forbidden outright),
 * and upholds ownership/atomicity/concurrency guarantees. Mirrors this
 * file's own "construct real repos, drive real use-cases" convention
 * exactly — `EditTransactionUseCase`/`DeleteTransactionUseCase` live in
 * `@afa/application`, so this suite belongs here (an app that depends on
 * both `@afa/application` and `@afa/infrastructure`), never in
 * `packages/infrastructure` itself (which must not depend on
 * `@afa/application` — the correct hexagonal dependency direction this
 * suite was originally, incorrectly, placed against before being moved).
 */
describe('TASK-FIN-004 (FR-FIN-006) — EditTransactionUseCase/DeleteTransactionUseCase for TRANSFER (real Postgres, end-to-end)', () => {
  const prisma = new PrismaService({ datasources: { db: { url: OWNER_DATABASE_URL } } });
  const userRepository = new PrismaUserRepository(prisma);
  const currencyRepository = new PrismaCurrencyRepository(prisma);
  const categoryRepository = new PrismaCategoryRepository(prisma, prisma);
  const accountRepository = new PrismaAccountRepository(prisma);
  const savingsGoalRepository = new PrismaSavingsGoalRepository(prisma);
  const fxRateRepository = new PrismaFxRateRepository(prisma);
  const transactionRepository = new PrismaTransactionRepository(prisma, prisma);
  const auditLogRepository = new PrismaTransactionAuditLogRepository(prisma);

  const createTransfer = new CreateTransferUseCase(
    userRepository,
    currencyRepository,
    categoryRepository,
    accountRepository,
    savingsGoalRepository,
    fxRateRepository,
    transactionRepository,
  );
  const editTransaction = new EditTransactionUseCase(
    transactionRepository,
    currencyRepository,
    categoryRepository,
    auditLogRepository,
    userRepository,
    accountRepository,
  );
  const deleteTransaction = new DeleteTransactionUseCase(transactionRepository, auditLogRepository);

  const TELEGRAM_USER_ID_G = 900_000_000_956n;
  const TELEGRAM_USER_ID_H = 900_000_000_957n;
  let userGId: string;
  let userHId: string;
  let cashAccountId: string;
  let bankAccountId: string;
  let usdAccountId: string;
  let goalId: string;
  let createdTransactionIds: string[] = [];

  function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return runWithUserContext(userId, fn);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();

    const userG = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_G },
      create: {
        telegramUserId: TELEGRAM_USER_ID_G,
        displayName: 'TASK-FIN-004 FR-FIN-006 Test G',
        timezone: 'UTC',
        defaultCurrency: UZS,
      },
      update: { status: 'active' },
    });
    userGId = userG.id;

    const userH = await prisma.user.upsert({
      where: { telegramUserId: TELEGRAM_USER_ID_H },
      create: {
        telegramUserId: TELEGRAM_USER_ID_H,
        displayName: 'TASK-FIN-004 FR-FIN-006 Test H',
        timezone: 'UTC',
        defaultCurrency: UZS,
      },
      update: { status: 'active' },
    });
    userHId = userH.id;

    const cashAccount = await accountRepository.create({
      userId: userGId,
      name: 'Cash',
      accountType: 'cash',
      currency: UZS,
      startingBalance: '0.00',
      isDefault: false,
    });
    cashAccountId = cashAccount.id;

    const bankAccount = await accountRepository.create({
      userId: userGId,
      name: 'Bank',
      accountType: 'bank_card',
      currency: UZS,
      startingBalance: '0.00',
      isDefault: false,
    });
    bankAccountId = bankAccount.id;

    const usdAccount = await accountRepository.create({
      userId: userGId,
      name: 'USD Savings',
      accountType: 'savings',
      currency: USD,
      startingBalance: '0.00',
      isDefault: false,
    });
    usdAccountId = usdAccount.id;

    const goal = await savingsGoalRepository.create({
      userId: userGId,
      name: 'Vacation fund',
      targetAmount: '5000000.00',
      currency: UZS,
      targetDate: null,
    });
    goalId = goal.id;
  });

  afterEach(async () => {
    if (createdTransactionIds.length > 0) {
      // EditTransactionUseCase/DeleteTransactionUseCase both write
      // transaction_audit_log rows (FR-EXP-007/FR-FIN-044) referencing the
      // transaction via a composite (transaction_id, transaction_date) FK —
      // those must be removed first, or the transactions delete below fails
      // with a foreign key violation (silently leaving the row — and every
      // later test's balance query polluted by it — behind).
      await prisma.transactionAuditLog.deleteMany({
        where: { transactionId: { in: createdTransactionIds } },
      });
      await prisma.transaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
    }
    createdTransactionIds = [];
    await prisma.account.updateMany({ where: { userId: userGId }, data: { status: 'active' } });
  });

  afterAll(async () => {
    await prisma.transactionAuditLog.deleteMany({
      where: { transaction: { userId: { in: [userGId, userHId] } } },
    });
    await prisma.transaction.deleteMany({ where: { userId: { in: [userGId, userHId] } } });
    await prisma.savingsGoal.deleteMany({ where: { userId: userGId } });
    await prisma.account.deleteMany({ where: { userId: userGId } });
    await prisma.notification.deleteMany({ where: { userId: { in: [userGId, userHId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userGId, userHId] } } });
    await prisma.onModuleDestroy();
  });

  async function makeTransfer(
    overrides: Partial<{
      sourceAccountId: string;
      destinationAccountId: string;
      amount: string;
      destinationAmount: string;
      goalId: string;
    }> = {},
  ) {
    const transfer = await as(userGId, () =>
      createTransfer.execute({
        userId: userGId,
        sourceAccountId: cashAccountId,
        destinationAccountId: bankAccountId,
        amount: '100000.00',
        transactionDate: new Date('2026-08-17'),
        description: 'Move cash to bank',
        originalText: `transfer ${randomUUID()}`,
        sourceType: 'manual',
        createdBy: 'user_manual',
        ...overrides,
      }),
    );
    createdTransactionIds.push(transfer.id);
    return transfer;
  }

  async function balanceOf(accountId: string): Promise<string | null> {
    return as(userGId, () =>
      accountRepository.computeBalance(accountId, userGId, new Date('2999-01-01')),
    );
  }

  it('G — a same-currency amount edit updates both accounts’ balances correctly', async () => {
    const transfer = await makeTransfer({ amount: '100000.00' });

    await as(userGId, () =>
      editTransaction.execute({
        transactionId: transfer.id,
        userId: userGId,
        changes: { amount: '150000.00' },
      }),
    );

    expect(await balanceOf(cashAccountId)).toBe('-150000.00');
    expect(await balanceOf(bankAccountId)).toBe('150000.00');
  }, 30_000);

  it('H — a cross-currency amount edit with a re-stated destinationAmount updates both accounts’ balances correctly', async () => {
    const transfer = await makeTransfer({
      destinationAccountId: usdAccountId,
      amount: '1000000.00',
      destinationAmount: '81.23',
    });

    await as(userGId, () =>
      editTransaction.execute({
        transactionId: transfer.id,
        userId: userGId,
        changes: { amount: '1200000.00', destinationAmount: '95.00' },
      }),
    );

    expect(await balanceOf(cashAccountId)).toBe('-1200000.00');
    expect(await balanceOf(usdAccountId)).toBe('95.00');
  }, 30_000);

  it('I — rejects a cross-currency amount edit that omits destinationAmount, leaving balances unchanged', async () => {
    const transfer = await makeTransfer({
      destinationAccountId: usdAccountId,
      amount: '1000000.00',
      destinationAmount: '81.23',
    });

    await expect(
      as(userGId, () =>
        editTransaction.execute({
          transactionId: transfer.id,
          userId: userGId,
          changes: { amount: '1200000.00' },
        }),
      ),
    ).rejects.toThrow(MissingDestinationAmountError);

    expect(await balanceOf(cashAccountId)).toBe('-1000000.00');
    expect(await balanceOf(usdAccountId)).toBe('81.23');
  }, 30_000);

  it('J — a metadata-only edit (description) leaves both accounts’ balances unchanged', async () => {
    const transfer = await makeTransfer({ amount: '100000.00' });

    const edited = await as(userGId, () =>
      editTransaction.execute({
        transactionId: transfer.id,
        userId: userGId,
        changes: { description: 'Corrected note' },
      }),
    );

    expect(edited.description).toBe('Corrected note');
    expect(await balanceOf(cashAccountId)).toBe('-100000.00');
    expect(await balanceOf(bankAccountId)).toBe('100000.00');
  }, 30_000);

  it('K — soft-deleting a TRANSFER excludes it from both accounts’ balances', async () => {
    const transfer = await makeTransfer({ amount: '75000.00' });
    expect(await balanceOf(cashAccountId)).toBe('-75000.00');
    expect(await balanceOf(bankAccountId)).toBe('75000.00');

    await as(userGId, () =>
      deleteTransaction.execute({ transactionId: transfer.id, userId: userGId }),
    );

    expect(await balanceOf(cashAccountId)).toBe('0.00');
    expect(await balanceOf(bankAccountId)).toBe('0.00');
  }, 30_000);

  it('L — rejects editing/deleting a TRANSFER belonging to a different user, leaving balances unchanged', async () => {
    const transfer = await makeTransfer({ amount: '60000.00' });

    await expect(
      as(userHId, () =>
        editTransaction.execute({
          transactionId: transfer.id,
          userId: userHId,
          changes: { amount: '999999.00' },
        }),
      ),
    ).rejects.toThrow(UnauthorizedTransactionAccessError);

    await expect(
      as(userHId, () => deleteTransaction.execute({ transactionId: transfer.id, userId: userHId })),
    ).rejects.toThrow(UnauthorizedTransactionAccessError);

    expect(await balanceOf(cashAccountId)).toBe('-60000.00');
  }, 30_000);

  it('M — a balance query as-of the transaction’s own date reflects the edited (current) amount, never a historical pre-edit value (no point-in-time reconstruction, by design)', async () => {
    const transfer = await makeTransfer({ amount: '10000.00' });

    await as(userGId, () =>
      editTransaction.execute({
        transactionId: transfer.id,
        userId: userGId,
        changes: { amount: '20000.00' },
      }),
    );

    const asOfTransactionDate = await as(userGId, () =>
      accountRepository.computeBalance(cashAccountId, userGId, new Date('2026-08-17')),
    );
    expect(asOfTransactionDate).toBe('-20000.00');
  }, 30_000);

  it('N — editing a TRANSFER whose destination account is archived (not deleted) still succeeds and balances correctly', async () => {
    await prisma.account.update({ where: { id: bankAccountId }, data: { status: 'archived' } });
    const transfer = await makeTransfer({ amount: '30000.00' });

    await as(userGId, () =>
      editTransaction.execute({
        transactionId: transfer.id,
        userId: userGId,
        changes: { amount: '40000.00' },
      }),
    );

    expect(await balanceOf(bankAccountId)).toBe('40000.00');
  }, 30_000);

  it('O — concurrent edits to the same TRANSFER never crash or deadlock; the final state is exactly one of the two submitted amounts', async () => {
    const transfer = await makeTransfer({ amount: '100000.00' });

    const results = await Promise.allSettled([
      as(userGId, () =>
        editTransaction.execute({
          transactionId: transfer.id,
          userId: userGId,
          changes: { amount: '111111.00' },
        }),
      ),
      as(userGId, () =>
        editTransaction.execute({
          transactionId: transfer.id,
          userId: userGId,
          changes: { amount: '222222.00' },
        }),
      ),
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(['-111111.00', '-222222.00']).toContain(await balanceOf(cashAccountId));
  }, 30_000);

  it('P — a concurrent edit and delete of the same TRANSFER never crash or deadlock (DISCLOSED: update() has no deletedAt guard, pre-existing/out of this stage’s scope, unchanged here)', async () => {
    const transfer = await makeTransfer({ amount: '50000.00' });

    const results = await Promise.allSettled([
      as(userGId, () =>
        editTransaction.execute({
          transactionId: transfer.id,
          userId: userGId,
          changes: { amount: '77777.00' },
        }),
      ),
      as(userGId, () => deleteTransaction.execute({ transactionId: transfer.id, userId: userGId })),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(Error);
      }
    }
    const finalRow = await prisma.transaction.findUnique({ where: { id: transfer.id } });
    expect(finalRow).not.toBeNull(); // soft-delete only — the row itself always survives
  }, 30_000);

  it('Q — an edit that fails on a DB-level constraint (bogus categoryId) rolls back the whole update, including destinationAmount and the TransactionEdited event', async () => {
    const transfer = await makeTransfer({ amount: '80000.00' });
    const bogusCategoryId = randomUUID();

    await expect(
      transactionRepository.update(transfer.id, {
        amount: '999999.00',
        categoryId: bogusCategoryId,
      } as never),
    ).rejects.toThrow();

    const row = await prisma.transaction.findUnique({ where: { id: transfer.id } });
    // Prisma's Decimal.toString() (decimal.js) normalizes away insignificant
    // trailing zeros for a whole-number value ('80000', not '80000.00') —
    // compared numerically here to avoid coupling this assertion to that
    // formatting detail; the actual thing being proven is "unchanged from
    // 80000", not a specific string shape.
    expect(Number(row?.amount)).toBe(80000);

    const events = await prisma.domainEvent.findMany({
      where: {
        eventType: 'TransactionEdited',
        payload: { path: ['transactionId'], equals: transfer.id },
      },
    });
    expect(events).toHaveLength(0);
  }, 30_000);

  it('R — rejects editing a goal-linked TRANSFER, leaving it fully unchanged', async () => {
    const transfer = await makeTransfer({ amount: '90000.00', goalId });

    await expect(
      as(userGId, () =>
        editTransaction.execute({
          transactionId: transfer.id,
          userId: userGId,
          changes: { amount: '111111.00' },
        }),
      ),
    ).rejects.toThrow(InvalidTransactionError);

    expect(await balanceOf(cashAccountId)).toBe('-90000.00');
  }, 30_000);

  it('S — rejects deleting a goal-linked TRANSFER, leaving it fully unchanged', async () => {
    const transfer = await makeTransfer({ amount: '45000.00', goalId });

    await expect(
      as(userGId, () => deleteTransaction.execute({ transactionId: transfer.id, userId: userGId })),
    ).rejects.toThrow(GoalLinkedTransferDeleteNotSupportedError);

    expect(await balanceOf(bankAccountId)).toBe('45000.00');
  }, 30_000);

  it('T — accepts a currency edit that transitions a cross-currency TRANSFER to same-currency, only when destinationAmount is explicitly cleared', async () => {
    // Source stays cashAccountId (UZS, matching the test user's own default
    // currency) so CreateTransferUseCase's exchangeRateToDefault resolution
    // takes the same-currency shortcut this file's own top describe block
    // already relies on (no FxRateRepository seed needed) — the
    // cross-currency SHAPE this test actually needs comes entirely from
    // destinationAccountId being the USD account, independent of that.
    const transfer = await makeTransfer({
      destinationAccountId: usdAccountId,
      amount: '1000000.00',
      destinationAmount: '81.23',
    });

    // Editing `currency` to USD makes it equal destinationAccount's own
    // currency (USD) — the same-currency condition — without touching
    // either account or needing any real FX rate lookup (EditTransactionUseCase
    // never calls FxRateRepository; its cross-currency check is a plain
    // string comparison against the destination account's currency).
    await expect(
      as(userGId, () =>
        editTransaction.execute({
          transactionId: transfer.id,
          userId: userGId,
          changes: { currency: USD },
        }),
      ),
    ).rejects.toThrow(InvalidDestinationAmountEditError);

    await as(userGId, () =>
      editTransaction.execute({
        transactionId: transfer.id,
        userId: userGId,
        changes: { currency: USD, destinationAmount: null },
      }),
    );

    const row = await prisma.transaction.findUnique({ where: { id: transfer.id } });
    expect(row?.destinationAmount).toBeNull();
    expect(row?.currency).toBe(USD);
  }, 30_000);
});

describe('TASK-FIN-004 Stage D — environment gate', () => {
  it('reports which credentials are present without ever fabricating a pass for the gated suite above', () => {
    const status = { DATABASE_URL: Boolean(process.env.DATABASE_URL) };
    // eslint-disable-next-line no-console -- deliberate, safe (presence boolean only).
    console.log('TASK-FIN-004 Stage D environment gate:', JSON.stringify(status));
    expect(typeof status.DATABASE_URL).toBe('boolean');
  });
});
