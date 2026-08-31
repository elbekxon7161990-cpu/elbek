import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import {
  addDecimalAmounts,
  FullCashFlowUnavailableError,
  roundDecimalAmountToScale,
  subtractDecimalAmounts,
} from '@afa/domain';

import { computeNetCashFlowRawParts, type NetCashFlowScope } from './compute-net-cash-flow';

/** Same shape `computeAccountBalance`/`computeNetCashFlow` already rely on. */
type QueryableClient = Pick<PrismaClient, '$queryRaw'> | Prisma.TransactionClient;

export type FullCashFlowScope = NetCashFlowScope;

interface RawTermResult {
  rawTerm: string;
  missingRateCount: bigint;
  missingRateCurrency: string | null;
}

/**
 * TASK-FIN-008 (§8.14.3's second formula) — `full_cash_flow(period) =
 * net_cash_flow(period) + Σ(DEBT_RECEIVED − DEBT_GIVEN + DEBT_REPAYMENT_RECEIVED
 * − DEBT_REPAYMENT_MADE, transaction_date within period)`, per BR-DBT-003/
 * BR-FIN-001's inclusion rule. The ONE shared implementation (FR-FIN-031).
 *
 * TWO DELIBERATE DEVIATIONS FROM §8.14.3's LITERAL TEXT, BOTH APPROVED
 * PRODUCT DECISIONS (not silently invented):
 *
 * 1. §8.14.3's formula text writes the four debt terms as if they were
 *    `transactions.transaction_type` values — they are not (Debt/DebtRepayment
 *    live in separate `debts`/`debt_repayments` tables, `userId`-scoped only,
 *    no account-linkage — confirmed this does NOT touch ADR-FIN-002's actual
 *    scope, which only governs `LOAN` vs `DEBT_GIVEN`/`DEBT_RECEIVED` being
 *    distinct record TYPES). `direction: 'given' | 'received'` on `Debt`
 *    (FR-DBT-001) is the authoritative source for which of the four terms a
 *    given debt/repayment row represents: a `Debt` with `direction='received'`
 *    is DEBT_RECEIVED (a new debt row with `direction='given'` is DEBT_GIVEN);
 *    a `DebtRepayment` on a `direction='given'` debt is money coming back
 *    (DEBT_REPAYMENT_RECEIVED), on a `direction='received'` debt is money
 *    paid out (DEBT_REPAYMENT_MADE). A repayment's own `currency` is always
 *    identical to its parent debt's `currency` (enforced by
 *    `LogDebtRepaymentUseCase`'s own matching filter — no cross-currency
 *    repayment case exists), so no repayment-to-debt currency conversion is
 *    ever needed, only repayment-currency-to-defaultCurrency.
 *
 * 2. §8.14.3's literal formula also omits `TRANSFER` — but FR-CSF-002
 *    ("...includes debt given/received and transfers") and BR-FIN-001
 *    ("[TRANSFER] optionally affects... the full cash-flow view, extending
 *    FR-CSF-002's existing inclusion of transfers") both explicitly require
 *    it. This is a documented PRD-internal omission in §8.14.3's own formula
 *    text, resolved per explicit product decision: transfers ARE always part
 *    of this formula (no toggle — "optional" refers to the report/view the
 *    user chooses to look at, not an internal parameter). The exact
 *    mathematical treatment is derived, not invented, from
 *    `compute-account-balance.ts`'s own established TRANSFER semantics and
 *    `CreateTransferUseCase`'s documented invariants: `t.currency` is always
 *    the SOURCE account's currency; the destination-side amount is
 *    `COALESCE(t.destination_amount, t.amount)`, denominated in the
 *    DESTINATION account's own currency (not independently rate-derived).
 *    Since BR-FIN-002 guarantees both legs of every `TRANSFER` belong to the
 *    SAME user, one row fully represents both sides of that user's own
 *    movement — no second query or account-linkage crossing needed. For a
 *    same-currency transfer this term is mechanically exactly `0` (both legs
 *    equal amount, equal currency — internal moves are cash-flow-neutral);
 *    for a cross-currency transfer it is generally nonzero, the correct
 *    consequence of applying BR-FIN-006 symmetrically to both legs.
 *
 * Precision: reuses `computeNetCashFlowRawParts` (raw income/expense, no
 * duplicated SQL) and accumulates every term — net-cash-flow, debt, repayment,
 * transfer — in RAW (unrounded) form, rounding exactly ONCE on the final
 * combined total (the "round once, at the very end" lesson this task's own
 * `computeNetCashFlow`/`computeNetWorth` fixes already established).
 *
 * FR-FIN-043: if ANY term (net-cash-flow's own transactions, debts,
 * repayments, or transfers) has a missing exchange rate, the entire
 * already-computed partial sum is discarded and `FullCashFlowUnavailableError`
 * is thrown — never a silently-incomplete figure.
 */
export async function computeFullCashFlow(
  client: QueryableClient,
  scope: FullCashFlowScope,
): Promise<string> {
  const [netCashFlowRaw, debtTerm, repaymentTerm, transferTerm] = await Promise.all([
    computeNetCashFlowRawParts(client, scope),
    computeRawDebtTerm(client, scope),
    computeRawRepaymentTerm(client, scope),
    computeRawTransferTerm(client, scope),
  ]);

  const missing = [debtTerm, repaymentTerm, transferTerm].find(
    (term) => term.missingRateCount > 0n,
  );
  if (missing) {
    throw new FullCashFlowUnavailableError(
      scope.userId,
      missing.missingRateCurrency ?? '(unknown)',
      scope.defaultCurrency,
    );
  }

  let raw = subtractDecimalAmounts(netCashFlowRaw.rawTotalIncome, netCashFlowRaw.rawTotalExpense);
  raw = addDecimalAmounts(raw, debtTerm.rawTerm);
  raw = addDecimalAmounts(raw, repaymentTerm.rawTerm);
  raw = addDecimalAmounts(raw, transferTerm.rawTerm);

  return roundDecimalAmountToScale(raw, 2);
}

async function computeRawDebtTerm(
  client: QueryableClient,
  scope: FullCashFlowScope,
): Promise<RawTermResult> {
  const rows = await client.$queryRaw<
    Array<{ raw_term: string; missing_rate_count: bigint; missing_rate_currency: string | null }>
  >`
    SELECT
      COALESCE(SUM(
        CASE
          WHEN d.currency = ${scope.defaultCurrency} AND d.direction = 'received' THEN d.original_amount
          WHEN d.currency = ${scope.defaultCurrency} AND d.direction = 'given' THEN -d.original_amount
          WHEN d.direction = 'received' THEN d.original_amount * fx.rate
          ELSE -(d.original_amount * fx.rate)
        END
      ), 0)::text AS raw_term,
      COUNT(*) FILTER (WHERE d.currency != ${scope.defaultCurrency} AND fx.rate IS NULL) AS missing_rate_count,
      MIN(d.currency) FILTER (WHERE d.currency != ${scope.defaultCurrency} AND fx.rate IS NULL) AS missing_rate_currency
    FROM debts d
    LEFT JOIN LATERAL (
      SELECT fxr.rate
      FROM fx_rates fxr
      WHERE fxr.base_currency = d.currency
        AND fxr.quote_currency = ${scope.defaultCurrency}
        AND fxr.as_of_date <= d.transaction_date
      ORDER BY fxr.as_of_date DESC
      LIMIT 1
    ) fx ON d.currency != ${scope.defaultCurrency}
    WHERE d.user_id = ${scope.userId}::uuid
      AND d.deleted_at IS NULL
      AND d.transaction_date BETWEEN ${scope.periodStart} AND ${scope.periodEnd}
  `;
  const row = rows[0];
  return {
    rawTerm: row?.raw_term ?? '0',
    missingRateCount: row?.missing_rate_count ?? 0n,
    missingRateCurrency: row?.missing_rate_currency ?? null,
  };
}

async function computeRawRepaymentTerm(
  client: QueryableClient,
  scope: FullCashFlowScope,
): Promise<RawTermResult> {
  const rows = await client.$queryRaw<
    Array<{ raw_term: string; missing_rate_count: bigint; missing_rate_currency: string | null }>
  >`
    SELECT
      COALESCE(SUM(
        CASE
          WHEN r.currency = ${scope.defaultCurrency} AND d.direction = 'given' THEN r.amount
          WHEN r.currency = ${scope.defaultCurrency} AND d.direction = 'received' THEN -r.amount
          WHEN d.direction = 'given' THEN r.amount * fx.rate
          ELSE -(r.amount * fx.rate)
        END
      ), 0)::text AS raw_term,
      COUNT(*) FILTER (WHERE r.currency != ${scope.defaultCurrency} AND fx.rate IS NULL) AS missing_rate_count,
      MIN(r.currency) FILTER (WHERE r.currency != ${scope.defaultCurrency} AND fx.rate IS NULL) AS missing_rate_currency
    FROM debt_repayments r
    JOIN debts d ON d.id = r.debt_id
    LEFT JOIN LATERAL (
      SELECT fxr.rate
      FROM fx_rates fxr
      WHERE fxr.base_currency = r.currency
        AND fxr.quote_currency = ${scope.defaultCurrency}
        AND fxr.as_of_date <= r.repayment_date
      ORDER BY fxr.as_of_date DESC
      LIMIT 1
    ) fx ON r.currency != ${scope.defaultCurrency}
    WHERE d.user_id = ${scope.userId}::uuid
      AND r.deleted_at IS NULL
      AND d.deleted_at IS NULL
      AND r.repayment_date BETWEEN ${scope.periodStart} AND ${scope.periodEnd}
  `;
  const row = rows[0];
  return {
    rawTerm: row?.raw_term ?? '0',
    missingRateCount: row?.missing_rate_count ?? 0n,
    missingRateCurrency: row?.missing_rate_currency ?? null,
  };
}

async function computeRawTransferTerm(
  client: QueryableClient,
  scope: FullCashFlowScope,
): Promise<RawTermResult> {
  const rows = await client.$queryRaw<
    Array<{ raw_term: string; missing_rate_count: bigint; missing_rate_currency: string | null }>
  >`
    SELECT
      COALESCE(SUM(
        (CASE
          WHEN t.currency = ${scope.defaultCurrency} THEN -t.amount
          ELSE -(t.amount * src_fx.rate)
        END)
        +
        (CASE
          WHEN dest_acc.currency = ${scope.defaultCurrency} THEN COALESCE(t.destination_amount, t.amount)
          ELSE COALESCE(t.destination_amount, t.amount) * dest_fx.rate
        END)
      ), 0)::text AS raw_term,
      COUNT(*) FILTER (
        WHERE (t.currency != ${scope.defaultCurrency} AND src_fx.rate IS NULL)
           OR (dest_acc.currency != ${scope.defaultCurrency} AND dest_fx.rate IS NULL)
      ) AS missing_rate_count,
      COALESCE(
        MIN(t.currency) FILTER (WHERE t.currency != ${scope.defaultCurrency} AND src_fx.rate IS NULL),
        MIN(dest_acc.currency) FILTER (WHERE dest_acc.currency != ${scope.defaultCurrency} AND dest_fx.rate IS NULL)
      ) AS missing_rate_currency
    FROM transactions t
    JOIN accounts dest_acc ON dest_acc.id = t.destination_account_id
    LEFT JOIN LATERAL (
      SELECT fxr.rate
      FROM fx_rates fxr
      WHERE fxr.base_currency = t.currency
        AND fxr.quote_currency = ${scope.defaultCurrency}
        AND fxr.as_of_date <= t.transaction_date
      ORDER BY fxr.as_of_date DESC
      LIMIT 1
    ) src_fx ON t.currency != ${scope.defaultCurrency}
    LEFT JOIN LATERAL (
      SELECT fxr.rate
      FROM fx_rates fxr
      WHERE fxr.base_currency = dest_acc.currency
        AND fxr.quote_currency = ${scope.defaultCurrency}
        AND fxr.as_of_date <= t.transaction_date
      ORDER BY fxr.as_of_date DESC
      LIMIT 1
    ) dest_fx ON dest_acc.currency != ${scope.defaultCurrency}
    WHERE t.user_id = ${scope.userId}::uuid
      AND t.deleted_at IS NULL
      AND t.transaction_type = 'TRANSFER'
      AND t.transaction_date BETWEEN ${scope.periodStart} AND ${scope.periodEnd}
  `;
  const row = rows[0];
  return {
    rawTerm: row?.raw_term ?? '0',
    missingRateCount: row?.missing_rate_count ?? 0n,
    missingRateCurrency: row?.missing_rate_currency ?? null,
  };
}
