import { Inject, Injectable } from '@nestjs/common';
import type { Loan, LoanRepository } from '@afa/domain';
import { LOAN_REPOSITORY } from '@afa/domain';

export interface ListOpenLoansInput {
  userId: string;
}

/** FR-FIN-009 — `/loans`: the user's own open loans only, mirroring `ListOpenDebtsUseCase`'s own thin, no-user-existence-check precedent. */
@Injectable()
export class ListOpenLoansUseCase {
  constructor(@Inject(LOAN_REPOSITORY) private readonly loanRepository: LoanRepository) {}

  async execute(input: ListOpenLoansInput): Promise<Loan[]> {
    return this.loanRepository.findOpenByUserId(input.userId);
  }
}
