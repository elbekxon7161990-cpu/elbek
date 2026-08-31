import { Injectable } from '@nestjs/common';
import type { Counterparty, CounterpartyRepository } from '@afa/domain';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { toDomainCounterparty } from './debt.mapper';

/**
 * TASK-FIN-002 — implements @afa/domain's `CounterpartyRepository` port
 * against the `counterparties` table (§13.6). `Counterparty` is
 * RLS-protected (`rls-protected-models.ts`); every method here uses
 * `this.prisma` (the RLS-extended client) directly — unlike
 * `PrismaTransactionRepository.create()`, no method here combines a
 * `Counterparty` write with a second table's write in the same database
 * transaction, so the `PRISMA_BASE_CLIENT`/manual `set_config` pattern is
 * not needed.
 */
@Injectable()
export class PrismaCounterpartyRepository implements CounterpartyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByUserId(userId: string): Promise<Counterparty[]> {
    const rows = await this.prisma.counterparty.findMany({ where: { userId } });
    return rows.map(toDomainCounterparty);
  }

  /**
   * `upsert()` alone is not sufficient to make this genuinely race-safe:
   * confirmed empirically against real Postgres (this task's own
   * integration tests) that two truly concurrent `upsert()` calls for the
   * same not-yet-existing `(userId, name)` can still race into the table's
   * own `UNIQUE (user_id, name)` violation — Prisma's `upsert` is not a
   * single atomic `INSERT ... ON CONFLICT DO UPDATE` statement in every
   * case (a documented Prisma limitation, not specific to this schema).
   * The fix is the officially recommended one: catch the resulting `P2002`
   * unique-constraint error and re-read the row the winning concurrent
   * call just created, rather than treating the loser's attempt as a real
   * failure.
   */
  async findOrCreateByName(userId: string, name: string): Promise<Counterparty> {
    try {
      const row = await this.prisma.counterparty.upsert({
        where: { userId_name: { userId, name } },
        create: { userId, name },
        update: {},
      });
      return toDomainCounterparty(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.counterparty.findUniqueOrThrow({
          where: { userId_name: { userId, name } },
        });
        return toDomainCounterparty(existing);
      }
      throw error;
    }
  }
}
