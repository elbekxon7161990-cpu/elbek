import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { AccountBalanceUnavailableError } from '@afa/domain';

import { formatDecimalAmount } from './format-decimal-amount';

/** Either the top-level extended client or an in-flight `$transaction` callback's `tx` — same shape `computeBudgetUsedAmount` already relies on. */
type QueryableClient = Pick<PrismaClient, '$queryRaw'> | Prisma.TransactionClient;

export interface AccountBalanceScope {
  accountId: string;
  currency: string;
  startingBalance: string;
  asOfDate: Date;
}

/**
 * §8.14.2's `account_balance` formula — "starting_balance + Σ(inflows) −
 * Σ(outflows), restricted to Committed-state records attributed to the
 * given account" — the ONE shared implementation (FR-FIN-031) every
 * consumer must call. Mirrors `compute-budget-used-amount.ts`'s exact
 * shape and reasoning.
 *
 * TASK-FIN-004 Stage G adds `TRANSFER` transfer-in/transfer-out handling
 * (AC-FIN-002, FR-FIN-006) — an explicitly scoped, disclosed correction:
 * an earlier version of this function excluded `TRANSFER` from the query
 * entirely, so a committed transfer never moved either account's balance.
 * `DEBT_*`/`LOAN_PAYMENT` inflows/outflows named in §8.14.2's prose remain
 * OUT of scope here (a separate, not-yet-scoped future stage) — the raw
 * `transactions` CHECK constraint doesn't even permit `DEBT_*`/
 * `LOAN_PAYMENT` as values (Debt/Loan live in their own tables), so those
 * terms structurally never match any data yet; no special-casing added.
 * `BALANCE_ADJUSTMENT` is a DB-permitted `transaction_type` value but no
 * use case creates one yet (FR-FIN-026 is a separate, unbuilt task) and its
 * sign convention (does its `amount` increase or decrease the balance?) is
 * nowhere defined — deliberately excluded from this query rather than
 * guessed; a disclosed gap for FR-FIN-026's own future task, not invented
 * here.
 *
 * Cross-currency (BR-FIN-006): an EXPENSE/INCOME/SALARY/REFUND transaction
 * whose own currency differs from the account's own currency is converted
 * via a `LATERAL` join against `fx_rates`, using that transaction's OWN
 * date with the exact same exact-date/most-recent-prior-date fallback
 * `FxRateRepository.findRate` (Stage C) already implements — re-expressed
 * as SQL here (rather than an N+1 per-row call to `findRate`) purely for
 * NFR-FIN-001's <300ms p95 single-query performance bar, not a different
 * rule. `Transaction.exchangeRateToDefault` is never read here — its
 * target is the *user's* default currency, not the *account's* currency,
 * which differ in the general case. Same-currency transactions never join
 * `fx_rates` at all — an implicit rate of `1`.
 *
 * `TRANSFER` deliberately NEVER joins `fx_rates` — per
 * `CreateTransferUseCase`'s own documented invariant, `t.currency` is
 * always the SOURCE account's currency (so the source-side outflow,
 * `t.amount`, is by construction already in the source account's own
 * currency — no conversion possible or needed), and the destination-side
 * inflow is `COALESCE(t.destination_amount, t.amount)`: for a same-
 * currency transfer `destination_amount` is `NULL` and `t.amount` already
 * equals the destination account's currency too (both accounts share one
 * currency); for a cross-currency transfer, `destination_amount` is the
 * user- or system-supplied amount already denominated in the destination
 * account's own currency (FR-FIN-005) — never a value this query has to
 * estimate via a live rate. A `TRANSFER` therefore can never trigger
 * `AccountBalanceUnavailableError`; the fx `LATERAL` join and the missing-
 * rate detection below are both scoped to EXPENSE/INCOME/SALARY/REFUND only.
 *
 * FR-FIN-043: if ANY attributed cross-currency EXPENSE/INCOME/SALARY/REFUND
 * transaction has no rate at all for its pair (not even a historical
 * fallback), the already-computed partial sum is discarded and
 * `AccountBalanceUnavailableError` is thrown — never a silently-incomplete
 * balance that looks valid.
 */
export async function computeAccountBalance(
  client: QueryableClient,
  scope: AccountBalanceScope,
): Promise<string> {
  return formatDecimalAmount(await computeAccountBalanceRaw(client, scope));
}

/**
 * TASK-FIN-008 (Option 2, `computeNetWorth`'s own precision-bug fix) — the
 * SAME query above, minus the final `formatDecimalAmount` rounding step.
 * `computeAccountBalance`'s own public contract (always a canonical
 * 2-decimal string) is unchanged for every existing caller — this function
 * exists ONLY so `computeNetWorth` can sum RAW, unrounded per-account
 * balances (after its own raw FX conversion) and round exactly ONCE on the
 * final cross-account total, instead of rounding each account's balance
 * individually first. Zero SQL duplication: `computeAccountBalance` is now
 * a two-line wrapper around this function, not a second implementation.
 */
export async function computeAccountBalanceRaw(
  client: QueryableClient,
  scope: AccountBalanceScope,
): Promise<string> {
  const rateableTypes = Prisma.sql`t.transaction_type IN ('INCOME', 'SALARY', 'REFUND', 'EXPENSE')`;

  const rows = await client.$queryRaw<
    Array<{ balance: string; missing_rate_count: bigint; missing_rate_currency: string | null }>
  >`
    SELECT
      (
        ${scope.startingBalance}::numeric + COALESCE(SUM(
          CASE
            WHEN t.transaction_type IN ('INCOME', 'SALARY', 'REFUND') AND t.currency = ${scope.currency} THEN t.amount
            WHEN t.transaction_type IN ('INCOME', 'SALARY', 'REFUND') THEN t.amount * fx.rate
            WHEN t.transaction_type = 'EXPENSE' AND t.currency = ${scope.currency} THEN -t.amount
            WHEN t.transaction_type = 'EXPENSE' THEN -(t.amount * fx.rate)
            WHEN t.transaction_type = 'TRANSFER' AND t.destination_account_id = ${scope.accountId}::uuid
              THEN COALESCE(t.destination_amount, t.amount)
            WHEN t.transaction_type = 'TRANSFER' AND t.source_account_id = ${scope.accountId}::uuid
              THEN -t.amount
            ELSE 0
          END
        ), 0)
      )::text AS balance,
      COUNT(*) FILTER (WHERE ${rateableTypes} AND t.currency != ${scope.currency} AND fx.rate IS NULL) AS missing_rate_count,
      MIN(t.currency) FILTER (WHERE ${rateableTypes} AND t.currency != ${scope.currency} AND fx.rate IS NULL) AS missing_rate_currency
    FROM transactions t
    LEFT JOIN LATERAL (
      SELECT fxr.rate
      FROM fx_rates fxr
      WHERE fxr.base_currency = t.currency
        AND fxr.quote_currency = ${scope.currency}
        AND fxr.as_of_date <= t.transaction_date
      ORDER BY fxr.as_of_date DESC
      LIMIT 1
    ) fx ON ${rateableTypes} AND t.currency != ${scope.currency}
    WHERE (
        t.account_id = ${scope.accountId}::uuid
        OR (
          t.transaction_type = 'TRANSFER'
          AND (t.source_account_id = ${scope.accountId}::uuid OR t.destination_account_id = ${scope.accountId}::uuid)
        )
      )
      AND t.deleted_at IS NULL
      AND t.transaction_date <= ${scope.asOfDate}
      AND t.transaction_type IN ('EXPENSE', 'INCOME', 'SALARY', 'REFUND', 'TRANSFER')
  `;

  const row = rows[0];
  if (row && row.missing_rate_count > 0n) {
    throw new AccountBalanceUnavailableError(
      scope.accountId,
      row.missing_rate_currency ?? '(unknown)',
      scope.currency,
    );
  }

  // RAW return — no `formatDecimalAmount` here. `starting_balance`
  // (Decimal(18,2)) and the SUM's cross-currency branch (t.amount * fx.rate,
  // Decimal(18,2) * Decimal(18,8) = a wider, 10-decimal-place Postgres
  // NUMERIC result) can leave the raw `::text` cast either trailing-zero-
  // trimmed or over-precise — `computeAccountBalance` (the public wrapper)
  // applies `formatDecimalAmount` on top of this value for every existing
  // caller; `computeNetWorth` instead accumulates this raw value across
  // accounts and rounds once, at the very end (TASK-FIN-008 Option 2).
  return row?.balance ?? scope.startingBalance;
}
