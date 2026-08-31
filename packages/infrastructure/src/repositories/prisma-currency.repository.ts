import { Injectable } from '@nestjs/common';
import type { CurrencyRepository } from '@afa/domain';

import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-FIN-001 Part 3 — queries the existing `currencies` reference table
 * (§13.8; no new schema). FR-EXP-003 collapses "exists" + "is_active" into
 * one supported/not boolean, never exposing the Prisma row shape.
 */
@Injectable()
export class PrismaCurrencyRepository implements CurrencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async isSupported(code: string): Promise<boolean> {
    const currency = await this.prisma.currency.findUnique({
      where: { code },
      select: { isActive: true },
    });
    return currency?.isActive === true;
  }

  async listActiveCodes(): Promise<string[]> {
    const rows = await this.prisma.currency.findMany({
      where: { isActive: true },
      select: { code: true },
    });
    return rows.map((row) => row.code);
  }
}
