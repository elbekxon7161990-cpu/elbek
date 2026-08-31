import { Inject, Injectable } from '@nestjs/common';
import type {
  NewTransactionData,
  TransactionEditableFields,
  TransactionRepository,
} from '@afa/domain';
import { normalizeTransactionInput, Transaction } from '@afa/domain';
import { getCurrentUserId } from '@afa/shared';

import { PRISMA_BASE_CLIENT } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateBudgetThresholdsOnExpenseCommit } from './evaluate-budget-thresholds-on-expense-commit';
import { evaluateSavingsGoalProgressOnContributionCommit } from './evaluate-savings-goal-progress-on-contribution-commit';
import { parseTransactionTime, toDomainTransaction } from './transaction.mapper';

/**
 * TASK-FIN-001 Part 3 — implements @afa/domain's `TransactionRepository`
 * port against the partitioned `transactions` table (§13.4/§13.12).
 *
 * Ownership scoping: `findById`/`update`/`softDelete`/`restore` take only an
 * `id`, matching the port signature Part 1/2 already fixed — ownership
 * ("does this transaction belong to the requesting user?") is checked by
 * the application-layer use cases *after* calling `findById`, not by these
 * methods themselves. `findByUserId` is the one method that scopes by user
 * at the query level.
 *
 * TASK-DB-011 update: RLS *is* now enforced against these queries (via the
 * `rls-user-context` extension `PrismaService`'s own DI factory applies —
 * see `prisma.module.ts`) for every method here except `create`, which has
 * its own, deliberate exception — see that method's own doc comment.
 */
@Injectable()
export class PrismaTransactionRepository implements TransactionRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PRISMA_BASE_CLIENT) private readonly basePrisma: PrismaService,
  ) {}

  async findById(id: string): Promise<Transaction | null> {
    const row = await this.prisma.transaction.findUnique({ where: { id } });
    return row ? toDomainTransaction(row) : null;
  }

  async findByUserId(
    userId: string,
    options?: { includeDeleted?: boolean },
  ): Promise<Transaction[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        ...(options?.includeDeleted ? {} : { deletedAt: null }),
      },
      // §13.4's dominant query pattern — a user's recent transactions first.
      orderBy: { transactionDate: 'desc' },
    });
    return rows.map(toDomainTransaction);
  }

  /**
   * TASK-REP-007-FIX — domain validation (`Transaction.validateNew`) now
   * runs BEFORE any database write, not after. Previously, `create()` wrote
   * the row and its paired domain event first, then only constructed/
   * validated the returned `Transaction` entity via `toDomainTransaction`
   * — meaning a value that fails domain validation (e.g. a future-dated
   * transaction) had ALREADY been durably persisted, orphaned, by the time
   * the caller ever saw the thrown error. `CreateExpenseUseCase`/
   * `CreateIncomeUseCase` (the only two production callers) already call
   * this exact validation themselves before invoking `create()` at all —
   * this method-level check is the same defense-in-depth this class's
   * other methods already apply via `toDomainTransaction`'s own
   * re-validation, just correctly ordered for the one method (`create`)
   * where "after" and "before" the write are not equivalent.
   *
   * Uses `now` for both `Transaction.validateNew`'s `now` and
   * `referenceLocalDate` parameters — the exact same (non-user-timezone-
   * aware) comparison `toDomainTransaction`'s own post-write validation
   * already performed by default. This repository has no access to
   * `User.timezone` (it only receives `NewTransactionData`), so it cannot
   * reproduce `CreateExpenseUseCase`'s more precise, timezone-aware check —
   * doing so would risk becoming STRICTER than that already-correct
   * upstream validation (e.g. rejecting a transaction dated "today" in an
   * ahead-of-UTC user's own timezone but "tomorrow" in server UTC), a new
   * regression this fix must not introduce. This is not a precision
   * regression versus the code being replaced, either: the previous
   * post-write check was exactly this same UTC-only comparison — moving it
   * earlier does not change what it checks, only when.
   *
   * TASK-DB-010 (FR-DB-014/FR-FIN-048) — the `transactions` row and its
   * paired `domain_events` (`TransactionCommitted`) row are written inside
   * ONE real PostgreSQL transaction, so they either both commit or both roll
   * back together — never observably one without the other.
   *
   * Uses `PRISMA_BASE_CLIENT` (the *unextended* client), not `this.prisma`
   * (the RLS-extended one every other method here uses), and issues the RLS
   * `set_config` manually inside the same transaction. This is deliberate,
   * not an oversight or a general RLS bypass: `Transaction` is
   * RLS-protected, and the `rls-user-context` extension
   * (`rls-context.extension.ts`) enforces that per *individual* model
   * operation by wrapping each one in its own independent
   * `basePrisma.$transaction([set_config, query])` — which cannot be
   * combined with a *second* write (`domain_events`) inside that same
   * database transaction, since the extension always opens its own separate
   * one. The only way to get both writes atomically coupled is to perform
   * the `set_config` and both inserts together, manually, in a single
   * interactive transaction — which is exactly what this method does,
   * preserving the same RLS enforcement the extension would have applied
   * (same session variable, same value, set before the protected write),
   * just combined with the outbox write instead of wrapped around it alone.
   *
   * `getCurrentUserId()` (the non-throwing variant) is used rather than
   * `requireCurrentUserId()` deliberately: outside a request/job context
   * with no user established — e.g. an owner-role integration test
   * exercising CRUD/mapping correctness rather than RLS enforcement itself,
   * the established convention for `*.integration.spec.ts` in this package —
   * there is nothing to set, and the owner role does not need RLS context to
   * write regardless (Postgres does not enforce row-level security against
   * a table's owner). In production, a user context is always established
   * before any repository call is reachable (`runWithUserContext` in
   * `apps/telegram-bot`'s own `bot.use()` middleware), so this is never
   * silently skipped there. If context is unexpectedly missing in a real,
   * RLS-enforced connection, the insert still fails safely — via Postgres's
   * own RLS policy rejection instead of the earlier, clearer
   * `MissingDatabaseUserContextError` — a deliberate, documented, narrow
   * trade-off made to avoid breaking every existing owner-role integration
   * test that (correctly, by established convention) never establishes a
   * user context at all. See this task's final report for the full
   * reasoning.
   */
  async create(data: NewTransactionData): Promise<Transaction> {
    // Validate BEFORE any database write — see this method's own doc
    // comment (TASK-REP-007-FIX) for why this must run first, not as part
    // of mapping the already-written row back afterward. Throws
    // `InvalidTransactionError` synchronously; nothing below this line has
    // executed yet, so no row and no domain event can exist for a rejected
    // create() call.
    const now = new Date();
    Transaction.validateNew(normalizeTransactionInput(data), now, now);

    // The transactions table is partitioned by transaction_date, so every FK
    // that targets a transactions row must reference the composite
    // (id, transaction_date) unique key, not id alone (schema.prisma's
    // header comment). linked_transaction_id therefore needs its paired
    // linked_transaction_date resolved before the insert. A plain read, not
    // part of the atomic write below — reused unchanged via the RLS-extended
    // client, same as every other read in this class.
    const linkedTransactionDate = data.linkedTransactionId
      ? await this.resolveTransactionDate(data.linkedTransactionId)
      : undefined;

    const userId = getCurrentUserId();

    // TASK-FIN-003 (budget concurrency hardening) — the default Prisma
    // interactive-transaction `timeout` (5000ms) proved marginal once
    // `evaluateBudgetThresholdsOnExpenseCommit` started taking a real
    // `FOR NO KEY UPDATE` lock: a transaction genuinely blocked waiting for
    // a concurrent sibling's own full sequence to finish (over a real,
    // non-local Postgres connection) could exceed that ceiling and have
    // Prisma itself kill the transaction (`P2028`), independent of Postgres
    // — confirmed empirically by this fix's own dedicated multi-budget
    // real-Postgres test. Widening the ceiling only ever removes a
    // premature-timeout risk; it changes no behavior for any transaction
    // type that already completes well within the old default.
    //
    // `maxWait` (default 2000ms) is a SEPARATE Prisma knob from `timeout` —
    // it bounds how long Prisma waits to acquire a connection and open the
    // transaction in the first place, before any of the above even starts.
    // Found marginal for the same reason during this fix's own mandatory
    // 10-consecutive-run proof: one run failed with "Unable to start a
    // transaction in the given time" (Prisma's own `maxWait` error, not
    // `P2028`) on the very first concurrency test, purely from ordinary
    // connection-acquisition latency against the shared pooled Postgres
    // connection — not lock contention. Widened alongside `timeout` for the
    // same reason: this is a shared-infrastructure safety margin, not a
    // behavior change.
    const row = await this.basePrisma.$transaction(
      async (tx) => {
        if (userId) {
          await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
        }

        const transactionRow = await tx.transaction.create({
          data: {
            userId: data.userId,
            transactionType: data.transactionType,
            // A plain string, never Number()/parseFloat — Prisma's Decimal
            // field parses it exactly via decimal.js, never through a JS
            // float intermediate (DB-P3/FR-DB-027).
            amount: data.amount,
            currency: data.currency,
            exchangeRateToDefault: data.exchangeRateToDefault,
            accountId: data.accountId,
            sourceAccountId: data.sourceAccountId,
            destinationAccountId: data.destinationAccountId,
            destinationAmount: data.destinationAmount,
            goalId: data.goalId,
            categoryId: data.categoryId,
            subcategoryId: data.subcategoryId,
            merchant: data.merchant,
            paymentMethod: data.paymentMethod,
            transactionDate: data.transactionDate,
            transactionTime: data.transactionTime
              ? parseTransactionTime(data.transactionTime)
              : undefined,
            location: data.location,
            tags: data.tags ?? [],
            description: data.description,
            originalText: data.originalText,
            sourceType: data.sourceType,
            sourceReference: data.sourceReference,
            confidenceScores: data.confidenceScores,
            isRecurringDetected: data.isRecurringDetected ?? false,
            linkedTransactionId: data.linkedTransactionId,
            linkedTransactionDate,
            createdBy: data.createdBy,
          },
        });

        // FR-FIN-048/§8.22.2 — "Any record type in this chapter enters the
        // Committed state" — a successful insert into `transactions` (there
        // is no separate draft/pending status on this table itself; drafts
        // live in the distinct `transaction_drafts` table, TASK-BOT-004) IS
        // that Committed transition, so this fires unconditionally, once, on
        // every successful create — never a second, independent transaction
        // of its own (that would reopen exactly the race FR-DB-014 forbids).
        //
        // `transactionDate` (TASK-DB-009/FR-DB-025) — an additive payload
        // field beyond §8.22.2's own `{transaction_id, user_id}` example,
        // added because cache invalidation cannot determine which
        // `report:{...}:{period_key}` keys are affected without it. See
        // `TransactionCommittedPayload`'s own doc comment (`@afa/domain`).
        await tx.domainEvent.create({
          data: {
            eventType: 'TransactionCommitted',
            payload: {
              transactionId: transactionRow.id,
              userId: data.userId,
              transactionDate: transactionRow.transactionDate.toISOString(),
            },
            status: 'pending',
          },
        });

        // TASK-FIN-003 (FR-BUD-004/005) — synchronous, same-transaction
        // budget threshold check, mirroring the Debt Reminder Producer
        // task's own "conditional event emission coupled to the write that
        // caused it" pattern. BR-BUD-001 — only EXPENSE transactions count
        // toward utilization, so this is a no-op (and no extra query cost)
        // for every other transaction type.
        if (data.transactionType === 'EXPENSE') {
          await evaluateBudgetThresholdsOnExpenseCommit(tx, {
            transactionId: transactionRow.id,
            userId: data.userId,
            categoryId: data.categoryId,
            subcategoryId: data.subcategoryId ?? null,
            transactionDate: transactionRow.transactionDate,
          });
        }

        // TASK-FIN-004 (Stage E, FR-FIN-013/014) — synchronous,
        // same-transaction savings-goal progress/milestone check, mirroring
        // the Budget threshold check immediately above. Fires for a
        // standalone `GOAL_CONTRIBUTION` (always has `goalId`) and for a
        // `TRANSFER` ONLY when the approved "linked transfer" contribution
        // mode set one (FR-FIN-012) — every other transaction type, and an
        // un-linked TRANSFER, is a no-op here (no extra query cost).
        if (
          data.goalId &&
          (data.transactionType === 'GOAL_CONTRIBUTION' || data.transactionType === 'TRANSFER')
        ) {
          await evaluateSavingsGoalProgressOnContributionCommit(tx, { goalId: data.goalId });
        }

        return transactionRow;
      },
      { timeout: 15_000, maxWait: 10_000 },
    );

    return toDomainTransaction(row);
  }

  /**
   * TASK-DB-009 (FR-DB-025) — emits `TransactionEdited` inside the SAME
   * transaction as the update itself, mirroring `create()`'s established
   * pattern exactly (manual `set_config` on the unextended `basePrisma`
   * client, since combining a second write with an RLS-protected model's
   * write cannot go through the RLS-extension's own per-operation wrapping
   * — see `create()`'s own doc comment for the full reasoning, unchanged
   * here). The one extra read (`previous.transactionDate`) is required
   * because `TransactionEdited`'s payload carries both the pre- and
   * post-edit date (`TransactionEditedPayload`'s own doc comment,
   * `@afa/domain`) — once this transaction commits, the pre-edit date is
   * otherwise unrecoverable from this row alone. Fires on every edit, not
   * only a date change — any field edit makes its containing period's
   * cached aggregate stale too.
   */
  async update(id: string, changes: Partial<TransactionEditableFields>): Promise<Transaction> {
    const userId = getCurrentUserId();

    const row = await this.basePrisma.$transaction(async (tx) => {
      if (userId) {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      }

      const previous = await tx.transaction.findUniqueOrThrow({
        where: { id },
        select: { transactionDate: true },
      });

      const updated = await tx.transaction.update({
        where: { id },
        data: {
          ...(changes.amount !== undefined && { amount: changes.amount }),
          ...(changes.currency !== undefined && { currency: changes.currency }),
          ...(changes.categoryId !== undefined && { categoryId: changes.categoryId }),
          ...(changes.subcategoryId !== undefined && { subcategoryId: changes.subcategoryId }),
          ...(changes.merchant !== undefined && { merchant: changes.merchant }),
          ...(changes.paymentMethod !== undefined && { paymentMethod: changes.paymentMethod }),
          ...(changes.transactionDate !== undefined && {
            transactionDate: changes.transactionDate,
          }),
          ...(changes.location !== undefined && { location: changes.location }),
          ...(changes.tags !== undefined && { tags: changes.tags }),
          ...(changes.description !== undefined && { description: changes.description }),
          // TASK-FIN-004 (FR-FIN-006) — TRANSFER only; `changes.destinationAmount`
          // is `string | null | undefined` (Partial<TransactionEditableFields>),
          // so this `!== undefined` guard correctly forwards an explicit
          // `null` (clearing the column) while leaving it untouched when
          // omitted — see EditTransactionUseCase for the validation that
          // guarantees this is only ever reached in a consistent state.
          ...(changes.destinationAmount !== undefined && {
            destinationAmount: changes.destinationAmount,
          }),
          // No `@updatedAt` attribute on this column (schema.prisma) — every
          // write path is responsible for bumping it itself.
          updatedAt: new Date(),
        },
      });

      await tx.domainEvent.create({
        data: {
          eventType: 'TransactionEdited',
          payload: {
            transactionId: updated.id,
            userId: updated.userId,
            previousTransactionDate: previous.transactionDate.toISOString(),
            newTransactionDate: updated.transactionDate.toISOString(),
          },
          status: 'pending',
        },
      });

      return updated;
    });

    return toDomainTransaction(row);
  }

  /**
   * TASK-BOT-007-FIX — a single atomic conditional `UPDATE ... WHERE id = ?
   * AND deleted_at IS NULL`, not the previous unconditional `update()`. Two
   * genuinely concurrent callers issuing this exact statement against the
   * same row can never both succeed: Postgres's own row-level locking
   * serializes the two writes, and whichever one commits second re-evaluates
   * `deleted_at IS NULL` against the now-already-updated row and matches zero
   * rows — no new locking primitive, no schema change, no version column,
   * the same guarantee `updateMany`'s `count` already gives for free. The
   * follow-up `findUniqueOrThrow` only runs after a successful conditional
   * write, so it carries no race risk of its own.
   *
   * TASK-DB-009 (FR-DB-025) update: the conditional `updateMany` + read +
   * `TransactionDeleted` emission now run inside ONE `basePrisma.$transaction`
   * (mirroring `create()`/`update()`), so the event is never observably
   * emitted for a delete that a concurrent loser's write didn't actually
   * win — `result.count === 0` (this call lost the race, or the row was
   * already deleted) returns `null` with no event emitted at all, exactly as
   * before this change. Wrapping the same conditional statement in an
   * explicit transaction does not change its own row-locking semantics —
   * a single-statement conditional `UPDATE` and the identical statement
   * inside a `$transaction` block serialize concurrent callers the same way
   * either way (re-verified by this task's own re-run of
   * `delete-transaction-concurrency.integration.spec.ts`, see this task's
   * final report).
   */
  async softDelete(id: string): Promise<Transaction | null> {
    const userId = getCurrentUserId();
    const now = new Date();

    return this.basePrisma.$transaction(async (tx) => {
      if (userId) {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      }

      const result = await tx.transaction.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: now, updatedAt: now },
      });
      if (result.count === 0) {
        return null;
      }

      const row = await tx.transaction.findUniqueOrThrow({ where: { id } });

      await tx.domainEvent.create({
        data: {
          eventType: 'TransactionDeleted',
          payload: {
            transactionId: row.id,
            userId: row.userId,
            transactionDate: row.transactionDate.toISOString(),
          },
          status: 'pending',
        },
      });

      return toDomainTransaction(row);
    });
  }

  /**
   * TASK-FIN-013 concurrency fix — atomic conditional `updateMany` (only a
   * currently-deleted row transitions), mirroring `softDelete`'s own
   * contract exactly. No `basePrisma`/manual `set_config` needed here (unlike
   * `softDelete`, which combines its write with a raw `domainEvent.create`
   * insert in one transaction) — both calls here run through the normal
   * RLS-extended `this.prisma` client, which already carries ALS user
   * context transparently for ordinary Prisma ORM operations.
   */
  async restore(id: string): Promise<Transaction | null> {
    const result = await this.prisma.transaction.updateMany({
      where: { id, deletedAt: { not: null } },
      data: { deletedAt: null, updatedAt: new Date() },
    });
    if (result.count === 0) {
      return null;
    }
    const row = await this.prisma.transaction.findUniqueOrThrow({ where: { id } });
    return toDomainTransaction(row);
  }

  /** TASK-FIN-013 (FR-UND-001) — see the port's own doc comment for why this is `updatedAt DESC`, not `findByUserId`'s `transactionDate DESC`. */
  async findMostRecentByUserId(userId: string): Promise<Transaction | null> {
    const row = await this.prisma.transaction.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return row ? toDomainTransaction(row) : null;
  }

  /** TASK-FIN-006 — the custom-category delete "migration preview" count, as either the transaction's category or subcategory. */
  async countActiveByCategoryId(userId: string, categoryId: string): Promise<number> {
    return this.prisma.transaction.count({
      where: {
        userId,
        deletedAt: null,
        OR: [{ categoryId }, { subcategoryId: categoryId }],
      },
    });
  }

  private async resolveTransactionDate(transactionId: string): Promise<Date> {
    const linked = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { transactionDate: true },
    });
    if (!linked) {
      throw new Error(`Cannot link to transaction "${transactionId}": it does not exist.`);
    }
    return linked.transactionDate;
  }
}
