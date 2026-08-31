import { Inject, Injectable } from '@nestjs/common';
import type {
  Counterparty,
  CounterpartyRepository,
  CurrencyRepository,
  Debt,
  DebtDirection,
  DebtRepository,
  DetectedLanguage,
  UserRepository,
} from '@afa/domain';
import {
  COUNTERPARTY_REPOSITORY,
  CURRENCY_REPOSITORY,
  Debt as DebtEntity,
  DEBT_REPOSITORY,
  generateCounterpartyAmbiguityMessage,
  matchCounterparty,
  USER_REPOSITORY,
} from '@afa/domain';

import { InvalidCurrencyError } from '../errors/invalid-currency.error';
import { UserNotFoundError } from '../errors/user-not-found.error';

/**
 * TASK-FIN-002 (Chapter 8 §8.3) — structured input only, mirroring
 * `CreateExpenseUseCase`'s own precedent: AI/natural-language extraction
 * for debts is not part of this task's approved scope (no
 * `TransactionExtractionCandidate`-equivalent schema or conversation-state
 * integration exists for DEBT_GIVEN/DEBT_RECEIVED yet — a future task).
 */
export interface CreateDebtInput {
  userId: string;
  direction: DebtDirection;
  counterpartyName: string;
  amount: string;
  currency: string;
  transactionDate: Date;
  dueDate?: Date;
  notes?: string;
  originalText: string;
  language: DetectedLanguage;
}

export interface DebtCreatedOutcome {
  kind: 'created';
  debt: Debt;
}

/** FR-DBT-008 — never silently choose an ambiguous counterparty; the caller must re-invoke with a resolved name (or a fresh, disambiguated one). */
export interface DebtCounterpartyAmbiguousOutcome {
  kind: 'counterparty_ambiguous';
  candidates: readonly Counterparty[];
  message: string;
}

export type CreateDebtOutcome = DebtCreatedOutcome | DebtCounterpartyAmbiguousOutcome;

@Injectable()
export class CreateDebtUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CURRENCY_REPOSITORY) private readonly currencyRepository: CurrencyRepository,
    @Inject(COUNTERPARTY_REPOSITORY)
    private readonly counterpartyRepository: CounterpartyRepository,
    @Inject(DEBT_REPOSITORY) private readonly debtRepository: DebtRepository,
  ) {}

  async execute(input: CreateDebtInput): Promise<CreateDebtOutcome> {
    const user = await this.userRepository.findById(input.userId);
    if (!user) {
      throw new UserNotFoundError(input.userId);
    }

    const currencySupported = await this.currencyRepository.isSupported(input.currency);
    if (!currencySupported) {
      throw new InvalidCurrencyError(input.currency);
    }

    const now = new Date();
    // Fail fast on every domain invariant (including §8.3.6's "due date not
    // already in the past") BEFORE touching counterparty state at all — no
    // wasted `findOrCreateByName` write for an input that was always going
    // to be rejected.
    DebtEntity.validateNew(
      {
        userId: input.userId,
        direction: input.direction,
        counterpartyName: input.counterpartyName,
        counterpartyRefId: null,
        originalAmount: input.amount,
        currency: input.currency,
        transactionDate: input.transactionDate,
        dueDate: input.dueDate ?? null,
        notes: input.notes ?? null,
        originalText: input.originalText,
      },
      now,
    );

    const existingCounterparties = await this.counterpartyRepository.findAllByUserId(input.userId);
    const match = matchCounterparty(input.counterpartyName, existingCounterparties);

    let counterpartyRefId: string;
    if (match.outcome === 'ambiguous') {
      return {
        kind: 'counterparty_ambiguous',
        candidates: match.candidates,
        message: generateCounterpartyAmbiguityMessage(match.candidates, input.language),
      };
    } else if (match.outcome === 'exact') {
      counterpartyRefId = match.counterparty.id;
    } else {
      const created = await this.counterpartyRepository.findOrCreateByName(
        input.userId,
        input.counterpartyName,
      );
      counterpartyRefId = created.id;
    }

    const debt = await this.debtRepository.create({
      userId: input.userId,
      direction: input.direction,
      counterpartyName: input.counterpartyName,
      counterpartyRefId,
      originalAmount: input.amount,
      currency: input.currency,
      transactionDate: input.transactionDate,
      dueDate: input.dueDate ?? null,
      notes: input.notes ?? null,
      originalText: input.originalText,
    });

    return { kind: 'created', debt };
  }
}
