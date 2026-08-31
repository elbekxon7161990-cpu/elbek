import type { Counterparty } from '../entities/counterparty.entity';

export const COUNTERPARTY_REPOSITORY = Symbol('COUNTERPARTY_REPOSITORY');

/**
 * TASK-FIN-002 — port for the `counterparties` table (§13.6), separate from
 * `DebtRepository` following the dedicated-repository-per-aggregate
 * precedent already established by `ExpenseHistoryRepository`/
 * `ReportQueryRepository` (their own doc comments) — `Counterparty` is its
 * own aggregate with its own lifecycle (matched/created independently of
 * any specific `Debt` write).
 */
export interface CounterpartyRepository {
  /** Scoped to one user (BR-DBT-002) — used by `matchCounterparty` callers to build the candidate pool before deciding exact/new/ambiguous. */
  findAllByUserId(userId: string): Promise<Counterparty[]>;

  /**
   * Idempotent by `(userId, name)` (the table's own `UNIQUE (user_id,
   * name)` constraint) — returns the existing row if one already has this
   * exact name for this user, otherwise creates it. Race-safe under real
   * concurrency: two concurrent callers minting the same new counterparty
   * name both resolve to the same single row, never a unique-constraint
   * failure surfaced to the caller (implementations must handle this
   * themselves — an `upsert` alone is not sufficient in every case; see
   * `PrismaCounterpartyRepository`'s own doc comment for why).
   */
  findOrCreateByName(userId: string, name: string): Promise<Counterparty>;
}
