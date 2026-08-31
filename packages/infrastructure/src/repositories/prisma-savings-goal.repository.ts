import { Injectable } from '@nestjs/common';
import type { NewSavingsGoalData, SavingsGoal, SavingsGoalRepository } from '@afa/domain';
import { SavingsGoal as SavingsGoalEntity } from '@afa/domain';

import { toDomainSavingsGoal } from './savings-goal.mapper';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-FIN-004 (Stage B) — implements @afa/domain's `SavingsGoalRepository`
 * port against the `savings_goals` table (§13.21.2). RLS-protected
 * (`rls-protected-models.ts` already lists `SavingsGoal`, built ahead of
 * this task's own arrival), same "no `PRISMA_BASE_CLIENT` needed" reasoning
 * `PrismaLoanRepository.create()`'s own doc comment gives — no catalogued
 * domain event exists for "a savings goal was created" either.
 */
@Injectable()
export class PrismaSavingsGoalRepository implements SavingsGoalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<SavingsGoal | null> {
    const row = await this.prisma.savingsGoal.findUnique({ where: { id } });
    return row ? toDomainSavingsGoal(row) : null;
  }

  async findActiveByUserId(userId: string): Promise<SavingsGoal[]> {
    const rows = await this.prisma.savingsGoal.findMany({
      where: { userId, status: 'active', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDomainSavingsGoal);
  }

  async create(data: NewSavingsGoalData): Promise<SavingsGoal> {
    const now = new Date();
    SavingsGoalEntity.validateNew(
      {
        userId: data.userId,
        name: data.name,
        targetAmount: data.targetAmount,
        currency: data.currency,
        targetDate: data.targetDate,
      },
      now,
    );

    const row = await this.prisma.savingsGoal.create({
      data: {
        userId: data.userId,
        name: data.name,
        targetAmount: data.targetAmount,
        currency: data.currency,
        targetDate: data.targetDate,
      },
    });
    return toDomainSavingsGoal(row);
  }
}
