import { Inject, Injectable } from '@nestjs/common';
import type { Debt, DebtRepository } from '@afa/domain';
import { DEBT_REPOSITORY } from '@afa/domain';

import { DebtNotFoundError } from '../errors/debt-not-found.error';
import { DebtNotOpenError } from '../errors/debt-not-open.error';
import { UnauthorizedDebtAccessError } from '../errors/unauthorized-debt-access.error';

export interface SettleDebtInput {
  userId: string;
  debtId: string;
}

/** FR-DBT-005 (P1) — explicit forgive/settle, `status: 'forgiven'`, distinct from a debt paid off via real repayments (`'repaid'`). */
@Injectable()
export class SettleDebtUseCase {
  constructor(@Inject(DEBT_REPOSITORY) private readonly debtRepository: DebtRepository) {}

  async execute(input: SettleDebtInput): Promise<Debt> {
    const existing = await this.debtRepository.findById(input.debtId);
    if (!existing) {
      throw new DebtNotFoundError(input.debtId);
    }
    // BR-DBT-002 — never let one user forgive another user's debt.
    if (existing.userId !== input.userId) {
      throw new UnauthorizedDebtAccessError(input.debtId, input.userId);
    }
    if (existing.status !== 'open') {
      throw new DebtNotOpenError(input.debtId, existing.status);
    }

    // The `findById`/status check above is a fast-path only — under real
    // concurrency, two calls can both read `status: 'open'` before either
    // write lands. `forgive`'s own atomic conditional `UPDATE ... WHERE
    // status = 'open'` is the actual guard (the same relationship
    // `DeleteTransactionUseCase` documents for `softDelete`'s `null`
    // return).
    const forgiven = await this.debtRepository.forgive(input.debtId, new Date());
    if (forgiven === null) {
      throw new DebtNotOpenError(input.debtId, 'open');
    }
    return forgiven;
  }
}
