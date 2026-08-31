import { Injectable } from '@nestjs/common';
import type {
  Budget,
  BudgetEditableFields,
  BudgetRepository,
  BudgetUtilization,
  NewBudgetData,
} from '@afa/domain';
import {
  Budget as BudgetEntity,
  DuplicateBudgetError,
  percentOf,
  subtractDecimalAmounts,
  toLocalCalendarDate,
} from '@afa/domain';
import { runWithUserContext } from '@afa/shared';
import type { Budget as PrismaBudgetRow } from '@prisma/client';

import { computeBudgetUsedAmount } from './compute-budget-used-amount';
import { formatDecimalAmount } from './format-decimal-amount';
import { toDomainBudget } from './budget.mapper';
import { PrismaService } from '../prisma/prisma.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * TASK-FIN-003 — implements @afa/domain's `BudgetRepository` port against
 * the `budgets`/`budget_notification_log` tables (§13.7). Both are
 * RLS-protected (`rls-protected-models.ts`, already listing `Budget`/
 * `BudgetNotificationLog` from when TASK-DB-011 built the policy set ahead
 * of this task's own arrival).
 */
@Injectable()
export class PrismaBudgetRepository implements BudgetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Budget | null> {
    const row = await this.prisma.budget.findUnique({ where: { id } });
    return row ? toDomainBudget(row) : null;
  }

  async findActiveByUserId(userId: string): Promise<Budget[]> {
    const rows = await this.prisma.budget.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDomainBudget);
  }

  /**
   * §8.4.7 — pre-checks the same partial-unique scope the real database
   * index (`uq_budgets_category_period`/`uq_budgets_overall_period`,
   * `migration.sql` — a `WHERE`-qualified partial index, which
   * `schema.prisma`'s own `@@unique` DSL cannot express, so it is not a
   * Prisma-recognized constraint) protects, then falls back to re-checking
   * the same scope on any unexpected write failure — the same "pre-check
   * for the common case, re-read on a caught race" shape
   * `PrismaCounterpartyRepository.findOrCreateByName`'s own P2002 fix
   * established, adapted here because this constraint isn't declared in
   * Prisma's own schema DSL and so cannot be reliably caught by its error
   * code alone.
   */
  async create(data: NewBudgetData): Promise<Budget> {
    const now = new Date();
    BudgetEntity.validateNew(data, now);

    const existing = await this.findExistingForScope(
      data.userId,
      data.scopeType,
      data.categoryId,
      data.periodType,
    );
    if (existing) {
      throw new DuplicateBudgetError(existing.id);
    }

    try {
      const row = await this.prisma.budget.create({
        data: {
          userId: data.userId,
          scopeType: data.scopeType,
          categoryId: data.categoryId,
          limitAmount: data.limitAmount,
          currency: data.currency,
          periodType: data.periodType,
          currentPeriodStart: data.currentPeriodStart,
          currentPeriodEnd: data.currentPeriodEnd,
        },
      });
      return toDomainBudget(row);
    } catch (error) {
      const raced = await this.findExistingForScope(
        data.userId,
        data.scopeType,
        data.categoryId,
        data.periodType,
      );
      if (raced) {
        throw new DuplicateBudgetError(raced.id);
      }
      throw error;
    }
  }

  private async findExistingForScope(
    userId: string,
    scopeType: 'category' | 'overall',
    categoryId: string | null,
    periodType: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.budget.findFirst({
      where: {
        userId,
        scopeType,
        categoryId,
        periodType,
        deletedAt: null,
      },
      select: { id: true },
    });
  }

  async update(id: string, userId: string, changes: BudgetEditableFields): Promise<Budget | null> {
    const result = await this.prisma.budget.updateMany({
      where: { id, userId, deletedAt: null },
      data: {
        ...(changes.limitAmount !== undefined && { limitAmount: changes.limitAmount }),
        ...(changes.categoryId !== undefined && { categoryId: changes.categoryId }),
        updatedAt: new Date(),
      },
    });
    if (result.count === 0) {
      return null;
    }
    const row = await this.prisma.budget.findUniqueOrThrow({ where: { id } });
    return toDomainBudget(row);
  }

  async softDelete(id: string, userId: string): Promise<Budget | null> {
    const now = new Date();
    const result = await this.prisma.budget.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: now, updatedAt: now },
    });
    if (result.count === 0) {
      return null;
    }
    const row = await this.prisma.budget.findUniqueOrThrow({ where: { id } });
    return toDomainBudget(row);
  }

  async computeUtilization(
    budgetId: string,
    userId: string,
    asOf: Date,
  ): Promise<BudgetUtilization | null> {
    const row = await this.prisma.budget.findFirst({
      where: { id: budgetId, userId, deletedAt: null },
    });
    if (!row) {
      return null;
    }
    return this.computeUtilizationForRow(row, asOf);
  }

  async computeUtilizationForAllActive(userId: string, asOf: Date): Promise<BudgetUtilization[]> {
    const rows = await this.prisma.budget.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    // Sequential, not Promise.all — a typical user has a handful of active
    // budgets (not a scale concern), and sequential queries avoid opening
    // many concurrent connections against the same RLS-scoped client for
    // what is, in practice, a small N (mirrors the Debt Reminder Producer's
    // own "sequential is fine, this isn't the hot path" reasoning, applied
    // here to a genuinely small per-user N rather than a background scan).
    const results: BudgetUtilization[] = [];
    for (const row of rows) {
      results.push(await this.computeUtilizationForRow(row, asOf));
    }
    return results;
  }

  private async computeUtilizationForRow(
    row: PrismaBudgetRow,
    asOf: Date,
  ): Promise<BudgetUtilization> {
    let categoryParentId: string | null = null;
    if (row.scopeType === 'category' && row.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: row.categoryId },
        select: { parentCategoryId: true },
      });
      categoryParentId = category?.parentCategoryId ?? null;
    }

    const limitAmount = formatDecimalAmount(row.limitAmount);
    const usedAmount = await computeBudgetUsedAmount(
      this.prisma,
      {
        userId: row.userId,
        scopeType: row.scopeType as 'category' | 'overall',
        categoryId: row.categoryId,
        categoryParentId,
        currency: row.currency,
        currentPeriodStart: row.currentPeriodStart,
        currentPeriodEnd: row.currentPeriodEnd,
      },
      null,
    );

    const utilizationPercent = percentOf(usedAmount, limitAmount);
    const remainingAmount = subtractDecimalAmounts(limitAmount, usedAmount);

    const asOfLocalDate = toLocalCalendarDate(asOf, 'UTC');
    const daysRemainingInPeriod = Math.max(
      0,
      Math.floor((row.currentPeriodEnd.getTime() - asOfLocalDate.getTime()) / MS_PER_DAY) + 1,
    );

    return {
      budget: toDomainBudget(row),
      usedAmount,
      utilizationPercent,
      remainingAmount,
      daysRemainingInPeriod,
    };
  }

  /**
   * NFR-BUD-002 — mirrors `PrismaDebtReminderRepository.findCandidates`'s
   * own N+1-by-design, per-user iteration: `Budget` is RLS-protected, so
   * there is no safe single query across every tenant's budgets (that
   * method's own doc comment explains the underlying reason in full; the
   * same reasoning applies here unchanged).
   */
  async findDueForRollover(now: Date): Promise<Budget[]> {
    const users = await this.prisma.user.findMany({
      where: { status: 'active' },
      select: { id: true, timezone: true },
    });

    const due: Budget[] = [];
    for (const user of users) {
      const localToday = toLocalCalendarDate(now, user.timezone);
      const rows = await runWithUserContext(user.id, () =>
        this.prisma.budget.findMany({
          where: {
            userId: user.id,
            status: 'active',
            deletedAt: null,
            currentPeriodEnd: { lt: localToday },
          },
        }),
      );
      due.push(...rows.map(toDomainBudget));
    }
    return due;
  }

  async rolloverPeriod(
    budgetId: string,
    expectedCurrentPeriodEnd: Date,
    nextPeriodStart: Date,
    nextPeriodEnd: Date,
  ): Promise<Budget | null> {
    const result = await this.prisma.budget.updateMany({
      where: { id: budgetId, currentPeriodEnd: expectedCurrentPeriodEnd, deletedAt: null },
      data: {
        currentPeriodStart: nextPeriodStart,
        currentPeriodEnd: nextPeriodEnd,
        updatedAt: new Date(),
      },
    });
    if (result.count === 0) {
      return null;
    }
    const row = await this.prisma.budget.findUniqueOrThrow({ where: { id: budgetId } });
    return toDomainBudget(row);
  }
}
