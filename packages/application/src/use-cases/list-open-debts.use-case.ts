import { Inject, Injectable } from '@nestjs/common';
import type { Debt, DebtRepository } from '@afa/domain';
import { DEBT_REPOSITORY } from '@afa/domain';

export interface ListOpenDebtsInput {
  userId: string;
}

/** FR-DBT-006 — `/debts`: the user's own open debts only, sorted by due date (nulls last) at the repository/SQL level; grouping by given/received direction is left to the presentation layer (mirrors `ListDraftsUseCase`'s own thin, no-user-existence-check precedent). */
@Injectable()
export class ListOpenDebtsUseCase {
  constructor(@Inject(DEBT_REPOSITORY) private readonly debtRepository: DebtRepository) {}

  async execute(input: ListOpenDebtsInput): Promise<Debt[]> {
    return this.debtRepository.findOpenByUserId(input.userId);
  }
}
