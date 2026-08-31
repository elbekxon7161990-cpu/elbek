import type { Account, AccountType } from '../entities/account.entity';

export const ACCOUNT_REPOSITORY = Symbol('ACCOUNT_REPOSITORY');

export interface NewAccountData {
  userId: string;
  name: string;
  accountType: AccountType;
  currency: string;
  startingBalance: string;
  isDefault: boolean;
}

/** FR-FIN-025 — "editing an account's metadata (name, type)" — only these two fields; `currency`/`startingBalance`/`isDefault` are deliberately not editable here (changing currency would corrupt every historical FX-snapshot calculation against this account; `startingBalance` corrections go through `BALANCE_ADJUSTMENT` per FR-FIN-026, not a retroactive edit). */
export interface AccountEditableFields {
  name?: string;
  accountType?: AccountType;
}

/**
 * TASK-FIN-007 (Chapter 8 §8.12) — port for the `accounts` table (§13.19.2),
 * following the dedicated-repository precedent `DebtRepository`/
 * `BudgetRepository` already established (an `Account` is not a
 * `Transaction`, and needs its own independent read/write path).
 */
export interface AccountRepository {
  findById(id: string): Promise<Account | null>;

  /** Scoped to one user, excludes both soft-deleted AND archived accounts — the normal "my accounts" view. An archived account remains findable via `findById` alone (FR-FIN-025 — "an archived account's historical transactions remain queryable"), it is simply excluded from this list. */
  findActiveByUserId(userId: string): Promise<Account[]>;

  /** Validates the not-yet-persisted account (`Account.validateNew`) BEFORE any database write, mirroring `DebtRepository.create()`'s own atomic-validation-first discipline. */
  create(data: NewAccountData): Promise<Account>;

  /** `userId` is part of the WHERE clause itself (an atomic conditional `UPDATE ... WHERE id = ? AND user_id = ?`), never a separate pre-fetch-then-compare check — the same ownership discipline `BudgetRepository.update()` already established. Returns `null` if the account does not exist, is soft-deleted, or is not owned by `userId`. */
  update(id: string, userId: string, changes: AccountEditableFields): Promise<Account | null>;

  /** FR-FIN-025 — sets `status = 'archived'`. Same atomic-conditional-`WHERE` ownership enforcement as `update()`. Returns `null` if not found/owned, or already archived. */
  archive(id: string, userId: string): Promise<Account | null>;

  /**
   * §8.12.4's edge case — "A user never creates an explicit account -> the
   * system provisions one implicit default account per currency the user
   * has transacted in." Mirrors `CounterpartyRepository.findOrCreateByName`'s
   * exact find-or-create-with-race-handling shape (TASK-FIN-002's own
   * established P2002-catch-and-reread pattern) — this is the one seam
   * `CreateExpenseUseCase`/`CreateIncomeUseCase` (Stage E) will call when a
   * transaction omits `accountId`, never a direct `create()` call.
   */
  findOrCreateDefaultForCurrency(userId: string, currency: string): Promise<Account>;

  /**
   * TASK-FIN-007 (Stage G, §8.14.2) — `account_balance(account, as_of_date)`,
   * the ONE shared implementation (FR-FIN-031) every consumer must call
   * rather than reimplementing. Live-computed (FR-FIN-024/FR-FIN-032), never
   * a stored/cached figure — `Account` itself deliberately holds no balance
   * column (see `account.entity.ts`'s own doc comment).
   *
   * Returns `null` if the account does not exist, is soft-deleted, or is
   * not owned by `userId` — the same "ownership enforced here, atomic
   * conditional" convention `update()`/`archive()` already establish. An
   * *archived* (but not soft-deleted) account's balance IS still computable
   * (FR-FIN-025 — "an archived account's historical transactions remain
   * queryable").
   *
   * Throws `AccountBalanceUnavailableError` (FR-FIN-043) if a transaction
   * attributed to this account is in a different currency than the
   * account's own and no exchange rate — not even a historical fallback —
   * exists for that pair as of the transaction's date. Never silently
   * substitutes a zero contribution for a missing rate.
   */
  computeBalance(accountId: string, userId: string, asOfDate: Date): Promise<string | null>;
}
