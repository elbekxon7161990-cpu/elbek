import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { addDecimalAmounts, multiplyDecimalAmounts, NetWorthUnavailableError } from '@afa/domain';

import { computeAccountBalanceRaw } from './compute-account-balance';
import { formatDecimalAmount } from './format-decimal-amount';

/** Same shape `computeAccountBalance`/`computeBudgetUsedAmount`/`computeSavingsGoalProgress` already rely on. */
type QueryableClient = Pick<PrismaClient, '$queryRaw'> | Prisma.TransactionClient;

export interface NetWorthScope {
  userId: string;
  /** The user's own `defaultCurrency` (§13.4 `users.default_currency`) — the target currency every account's balance is converted to. */
  defaultCurrency: string;
  asOfDate: Date;
}

/**
 * TASK-FIN-008 (§8.14.2) — `net_worth(user, as_of_date) =
 * Σ(account_balance(account, as_of_date) for every account belonging to
 * user, converted to default_currency per §8.13.3 BR-FIN-006)`. The ONE
 * shared implementation (FR-FIN-031).
 *
 * Deliberately built as a two-step computation, NOT a single combined SQL
 * query duplicating `computeAccountBalance`'s own CASE-based formula
 * inline: (1) fetch every non-deleted account for the user, (2) call
 * `computeAccountBalanceRaw` once per account — the raw-output sibling of
 * the SAME authoritative §8.14.2 `account_balance` implementation every
 * other consumer uses via `computeAccountBalance`, never a second copy of
 * its arithmetic — then (3) convert each account's own RAW balance
 * (already correct, just unrounded, in the account's OWN currency) to
 * `scope.defaultCurrency` via a single-value FX lookup, accumulate the raw
 * converted values, and round the cross-account TOTAL exactly once at the
 * very end (`formatDecimalAmount`, the return statement). A per-account
 * loop, not a single combined query, mirrors `prisma-budget.repository.ts`'s
 * own established "genuinely small per-user N" precedent (a user's account
 * count).
 *
 * TASK-FIN-008 precision-bug fix (Option 2): the original version called
 * the PUBLIC `computeAccountBalance` (already 2-decimal-rounded by that
 * function's own contract) and rounded each cross-currency conversion
 * individually before summing — since HALF-UP rounding is not distributive
 * over addition, `round(a) + round(b)` can differ from `round(a + b)` by a
 * cent whenever a raw converted value carries more than 2 decimal places
 * (the normal case for any `Decimal(18,2) × Decimal(18,8)` FX conversion).
 * Switching to `computeAccountBalanceRaw` + a single terminal round fixes
 * this WITHOUT touching `computeAccountBalance`'s own public contract or
 * any of its other existing callers, and without a second, independently-
 * maintained SQL implementation of `account_balance` (zero new SQL was
 * written — `computeAccountBalanceRaw` is the exact same query, `compute-account-balance.ts`
 * itself just now exposes it before its own final rounding step).
 *
 * Includes ARCHIVED accounts (only `deleted_at IS NOT NULL` is excluded) —
 * matching `computeAccountBalance`'s own documented stance that "an
 * archived (not soft-deleted) account remains computable" (an archived
 * account still holds real money that belongs in the user's net worth).
 *
 * The per-account currency-conversion step is a SEPARATE FX lookup from
 * `computeAccountBalance`'s own internal per-TRANSACTION LATERAL join
 * (which converts individual cross-currency transactions to the ACCOUNT's
 * own currency) — this one converts the resulting ACCOUNT-level aggregate
 * balance to the USER's default currency, the same "most recent rate on or
 * before the date" rule (`FxRateRepository.findRate`'s own rule,
 * re-expressed as a single-row raw query here rather than an extra
 * repository round trip per account), fail-loud
 * (`NetWorthUnavailableError`, FR-FIN-043) if no rate exists at all for an
 * account's currency pair.
 *
 * Scope note (NFR-FIN-004): §8.23.2 requires whole-history aggregates like
 * `net_worth` to eventually be INCREMENTALLY MAINTAINED (via
 * `user_financial_summary`, §13.37) rather than live-recomputed on every
 * request — that materialization/caching layer is TASK-DB-009's own,
 * separate, not-yet-built scope (its `Dependencies` never lists
 * TASK-FIN-008). This function is the live, always-correct FORMULA
 * TASK-FIN-008 is responsible for (FR-FIN-032's "computed live... never
 * from a snapshot that could go stale" baseline every §8.14 formula
 * already satisfies before any caching layer exists) — TASK-DB-009 may
 * later wrap or pre-compute this same result for NFR-FIN-002's <800ms p95
 * bar; this function's own contract does not change either way.
 */
export async function computeNetWorth(
  client: QueryableClient,
  scope: NetWorthScope,
): Promise<string> {
  const accounts = await client.$queryRaw<
    Array<{ id: string; currency: string; starting_balance: string }>
  >`
    SELECT id, currency, starting_balance::text as starting_balance
    FROM accounts
    WHERE user_id = ${scope.userId}::uuid AND deleted_at IS NULL
  `;

  // TASK-FIN-008 (precision-bug fix, Option 2) — accumulate RAW (unrounded)
  // per-account balances via `computeAccountBalanceRaw`, apply the
  // cross-currency conversion at full precision (`multiplyDecimalAmounts`,
  // exact, no intermediate rounding), and round the FINAL cross-account
  // total exactly ONCE. The previous version called the public
  // `computeAccountBalance` (already 2-decimal-rounded) and additionally
  // rounded each cross-currency conversion individually before summing —
  // HALF-UP is not distributive over addition, so `round(a) + round(b)`
  // can differ from `round(a + b)` whenever a raw converted value carries
  // more than 2 decimal places. `computeAccountBalance`'s own public
  // contract (and every one of its OTHER existing callers) is completely
  // unchanged — only `computeNetWorth` was switched to the raw variant.
  let rawTotal = '0';
  for (const account of accounts) {
    const rawAccountBalance = await computeAccountBalanceRaw(client, {
      accountId: account.id,
      currency: account.currency,
      startingBalance: formatDecimalAmount(account.starting_balance),
      asOfDate: scope.asOfDate,
    });

    if (account.currency === scope.defaultCurrency) {
      rawTotal = addDecimalAmounts(rawTotal, rawAccountBalance);
      continue;
    }

    const rateRows = await client.$queryRaw<Array<{ rate: string }>>`
      SELECT rate::text as rate
      FROM fx_rates
      WHERE base_currency = ${account.currency}
        AND quote_currency = ${scope.defaultCurrency}
        AND as_of_date <= ${scope.asOfDate}
      ORDER BY as_of_date DESC
      LIMIT 1
    `;
    if (rateRows.length === 0) {
      throw new NetWorthUnavailableError(scope.userId, account.currency, scope.defaultCurrency);
    }

    const rawConverted = multiplyDecimalAmounts(rawAccountBalance, rateRows[0]!.rate);
    rawTotal = addDecimalAmounts(rawTotal, rawConverted);
  }

  return formatDecimalAmount(rawTotal);
}
