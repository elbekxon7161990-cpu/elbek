import { Inject, Injectable } from '@nestjs/common';
import type { DebtDirection, DebtRepository, LogDebtRepaymentData, NewDebtData } from '@afa/domain';
import { Debt, DebtRepayment } from '@afa/domain';
import { getCurrentUserId } from '@afa/shared';

import { PRISMA_BASE_CLIENT } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { toDomainDebt, toDomainDebtRepayment } from './debt.mapper';

/**
 * TASK-FIN-002 — implements @afa/domain's `DebtRepository` port against the
 * `debts`/`debt_repayments` tables (§13.6). Both are RLS-protected
 * (`rls-protected-models.ts`).
 */
@Injectable()
export class PrismaDebtRepository implements DebtRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PRISMA_BASE_CLIENT) private readonly basePrisma: PrismaService,
  ) {}

  async findById(id: string): Promise<Debt | null> {
    const row = await this.prisma.debt.findUnique({ where: { id } });
    return row ? toDomainDebt(row) : null;
  }

  async findOpenByUserId(userId: string): Promise<Debt[]> {
    const rows = await this.prisma.debt.findMany({
      where: { userId, status: 'open', deletedAt: null },
      orderBy: { dueDate: 'asc' },
    });
    return rows.map(toDomainDebt);
  }

  async findSettledByUserId(userId: string): Promise<Debt[]> {
    const rows = await this.prisma.debt.findMany({
      where: { userId, status: { in: ['repaid', 'forgiven'] }, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(toDomainDebt);
  }

  async findOpenByCounterparty(
    userId: string,
    counterpartyRefId: string,
    direction: DebtDirection,
  ): Promise<Debt[]> {
    const rows = await this.prisma.debt.findMany({
      where: { userId, counterpartyRefId, direction, status: 'open', deletedAt: null },
      orderBy: { dueDate: 'asc' },
    });
    return rows.map(toDomainDebt);
  }

  /**
   * Validates BEFORE any database write (the atomic-validation lesson,
   * `PrismaTransactionRepository.create()`'s own precedent). A single-table
   * insert with no domain event (no catalogued `DomainEventType` exists for
   * "a debt was created" — the only Debt-related event types,
   * `DebtDueApproaching`/`DebtOverdue`/`DebtSettled`, are structurally tied
   * to the deferred notification pipeline, FR-DBT-007/TASK-BOT-009 — this
   * task does not invent a producer for them), so the normal RLS-extended
   * `this.prisma` is used directly; no `PRISMA_BASE_CLIENT`/manual
   * `set_config` coupling is needed here, unlike `logRepayment` below.
   */
  async create(data: NewDebtData): Promise<Debt> {
    const now = new Date();
    Debt.validateNew(
      {
        userId: data.userId,
        direction: data.direction,
        counterpartyName: data.counterpartyName,
        counterpartyRefId: data.counterpartyRefId,
        originalAmount: data.originalAmount,
        currency: data.currency,
        transactionDate: data.transactionDate,
        dueDate: data.dueDate,
        notes: data.notes,
        originalText: data.originalText,
      },
      now,
    );

    const row = await this.prisma.debt.create({
      data: {
        userId: data.userId,
        direction: data.direction,
        counterpartyName: data.counterpartyName,
        counterpartyRefId: data.counterpartyRefId,
        originalAmount: data.originalAmount,
        outstandingBalance: data.originalAmount,
        currency: data.currency,
        transactionDate: data.transactionDate,
        dueDate: data.dueDate,
        notes: data.notes,
        originalText: data.originalText,
      },
    });
    return toDomainDebt(row);
  }

  /**
   * TASK-FIN-008 (§8.14.6) — this `UPDATE`, together with `Debt.applyRepayment`
   * (the domain-level pre-check, `@afa/domain`), is the authoritative
   * `debt_outstanding_balance` implementation (FR-FIN-031) — reviewed
   * explicitly during TASK-FIN-008's own consolidation audit and APPROVED
   * to remain as-is. §8.14.6's formula is written as a live recompute
   * (`debt.original_amount − Σ(linked DEBT_REPAYMENT_*.amount)`), but this
   * repository instead maintains `outstanding_balance` as a DECREMENT-ON-WRITE
   * stored column — architecturally different from `account_balance`/
   * `budget_utilization`/`goal_progress` (all fresh `$queryRaw` SUMs on every
   * call, no stored running total). This divergence is a deliberate,
   * approved product decision, not an oversight or something TASK-FIN-008
   * silently reconciled: Debt's decrement-on-write shape predates this task,
   * is already correct (TOCTOU-safe, real-Postgres proven — see this file's
   * own concurrency test), and re-deriving it as a live SUM would be a
   * behavior-risking rewrite of already-verified production logic, exactly
   * what this task's own scope explicitly excludes.
   *
   * A coupled pair of writes — the `DebtRepayment` insert and the parent
   * `Debt`'s balance/status update must both commit or both roll back
   * together, so this uses the exact same `PRISMA_BASE_CLIENT` + manual
   * `set_config` pattern `PrismaTransactionRepository.create()`/`update()`/
   * `softDelete()` established: RLS's own per-operation wrapping
   * (`rls-context.extension.ts`) cannot combine two protected-model writes
   * into one database transaction, since it always opens its own separate
   * one per call.
   *
   * The balance update is one conditional, DB-computed `UPDATE` — never
   * read-then-write — so it is TOCTOU-safe under concurrency and is
   * BR-DBT-001's actual enforcement point (the domain-level
   * `Debt.applyRepayment` pre-check the application layer calls first is
   * the primary UX path; this is the backstop). `data.amount` is passed as
   * a plain canonical decimal string through `$queryRaw`'s own
   * parameterization (never wrapped in a JS number) — Postgres performs
   * the actual arithmetic against the `NUMERIC(18,2)` column server-side,
   * matching `PrismaReportQueryRepository.getPeriodicBreakdown()`'s own
   * established raw-SQL parameter convention.
   */
  async logRepayment(
    data: LogDebtRepaymentData,
  ): Promise<{ debt: Debt; repayment: DebtRepayment } | null> {
    const now = new Date();
    DebtRepayment.validateNew(
      {
        debtId: data.debtId,
        amount: data.amount,
        currency: data.currency,
        repaymentDate: data.repaymentDate,
        originalText: data.originalText,
      },
      now,
    );

    const userId = getCurrentUserId();

    return this.basePrisma.$transaction(async (tx) => {
      if (userId) {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      }

      const updatedRows = await tx.$queryRaw<Array<Record<string, unknown>>>`UPDATE debts
        SET outstanding_balance = outstanding_balance - ${data.amount}::numeric,
            status = CASE
              WHEN outstanding_balance - ${data.amount}::numeric = 0 THEN 'repaid'
              ELSE status
            END,
            updated_at = ${now}
        WHERE id = ${data.debtId}::uuid
          AND status = 'open'
          AND deleted_at IS NULL
          AND outstanding_balance >= ${data.amount}::numeric
        RETURNING *`;

      if (updatedRows.length === 0) {
        return null;
      }

      const repaymentRow = await tx.debtRepayment.create({
        data: {
          debtId: data.debtId,
          amount: data.amount,
          currency: data.currency,
          repaymentDate: data.repaymentDate,
          originalText: data.originalText,
        },
      });

      const debtRow = await tx.debt.findUniqueOrThrow({ where: { id: data.debtId } });

      // Debt Reminder Producer task (§8.22.2 — "DebtSettled ... Debt status
      // transitions to repaid/forgiven") — a discrete state-transition
      // event, emitted the same way TransactionCommitted/Edited/Deleted
      // already are: inside the SAME transaction as the write that causes
      // it (FR-DB-014), never a separate, non-atomic follow-up call. Fires
      // only on the repayment that actually closes the debt (balance
      // reaches exactly zero) — a partial repayment leaves `status`
      // unchanged and emits nothing.
      if (debtRow.status === 'repaid') {
        await tx.domainEvent.create({
          data: {
            eventType: 'DebtSettled',
            payload: {
              debtId: debtRow.id,
              userId: debtRow.userId,
              counterpartyName: debtRow.counterpartyName,
              status: 'repaid',
            },
            status: 'pending',
          },
        });
      }

      return { debt: toDomainDebt(debtRow), repayment: toDomainDebtRepayment(repaymentRow) };
    });
  }

  /**
   * FR-DBT-005 — now couples the atomic conditional `UPDATE` with a
   * `DebtSettled` emission (§8.22.2) in the same transaction, mirroring
   * `logRepayment()`'s own reasoning above. Converted from a plain
   * `this.prisma.debt.updateMany` (no coupled write, TASK-FIN-002's own
   * original design) to `basePrisma.$transaction` + manual `set_config` —
   * the same RLS-extension-vs-second-write conflict `PrismaTransactionRepository.create()`
   * already solves, now needed here because this method combines two
   * writes (the update AND the domain event insert) for the first time.
   */
  async forgive(debtId: string, now: Date): Promise<Debt | null> {
    const userId = getCurrentUserId();

    return this.basePrisma.$transaction(async (tx) => {
      if (userId) {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      }

      const result = await tx.debt.updateMany({
        where: { id: debtId, status: 'open', deletedAt: null },
        data: { status: 'forgiven', updatedAt: now },
      });
      if (result.count === 0) {
        return null;
      }
      const row = await tx.debt.findUniqueOrThrow({ where: { id: debtId } });

      await tx.domainEvent.create({
        data: {
          eventType: 'DebtSettled',
          payload: {
            debtId: row.id,
            userId: row.userId,
            counterpartyName: row.counterpartyName,
            status: 'forgiven',
          },
          status: 'pending',
        },
      });

      return toDomainDebt(row);
    });
  }
}
