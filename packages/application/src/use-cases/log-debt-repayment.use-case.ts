import { Inject, Injectable } from '@nestjs/common';
import type {
  Counterparty,
  CounterpartyRepository,
  CurrencyRepository,
  Debt,
  DebtDirection,
  DebtRepayment,
  DebtRepository,
  DetectedLanguage,
  UserRepository,
} from '@afa/domain';
import {
  COUNTERPARTY_REPOSITORY,
  CURRENCY_REPOSITORY,
  DEBT_REPOSITORY,
  DebtOverpaymentError,
  generateCounterpartyAmbiguityMessage,
  generateNoMatchingDebtMessage,
  generateOverpaymentConfirmationMessage,
  generateRepaymentMatchAmbiguityMessage,
  matchCounterparty,
  USER_REPOSITORY,
} from '@afa/domain';

import { InvalidCurrencyError } from '../errors/invalid-currency.error';
import { UserNotFoundError } from '../errors/user-not-found.error';

/**
 * `'made'` — the user paid back a debt THEY owed (matches an open `Debt`
 * with `direction: 'received'`, i.e. money the user originally received).
 * `'received'` — the user was paid back for a debt owed TO them (matches
 * `direction: 'given'`). FR-DBT-003's own two intents (DEBT_REPAYMENT_MADE /
 * DEBT_REPAYMENT_RECEIVED), named from the repayment's own perspective
 * rather than the original debt's, to match how a user would actually
 * describe a repayment ("I paid Aziz back" / "Aziz paid me back").
 */
export type RepaymentDirection = 'made' | 'received';

export interface LogDebtRepaymentInput {
  userId: string;
  counterpartyName: string;
  repaymentDirection: RepaymentDirection;
  amount: string;
  currency: string;
  repaymentDate: Date;
  originalText: string;
  language: DetectedLanguage;
  /** BR-DBT-001 — must be explicitly `true` to apply a repayment larger than the matched debt's outstanding balance. Defaults to `false`; a first call that turns out to be an overpayment always returns `overpayment_confirmation_required` instead of guessing. */
  confirmOverpayment?: boolean;
}

export interface DebtRepaidOutcome {
  kind: 'repaid';
  debt: Debt;
  repayment: DebtRepayment;
  /** `true` when the confirmed amount exceeded the outstanding balance and was capped to it (BR-DBT-001 — outstanding_balance must never go negative) — the excess is not tracked as a separate credit; see this task's final report. */
  cappedFromOverpayment: boolean;
}

export interface RepaymentCounterpartyAmbiguousOutcome {
  kind: 'counterparty_ambiguous';
  candidates: readonly Counterparty[];
  message: string;
}

export interface NoMatchingDebtOutcome {
  kind: 'no_matching_debt';
  message: string;
}

export interface DebtMatchAmbiguousOutcome {
  kind: 'debt_ambiguous';
  candidates: readonly Debt[];
  message: string;
}

export interface OverpaymentConfirmationRequiredOutcome {
  kind: 'overpayment_confirmation_required';
  debt: Debt;
  attemptedAmount: string;
  message: string;
}

/** The one open debt this call matched was no longer open by the time `logRepayment`'s own atomic write ran (concurrently settled/forgiven) — the same real-concurrency backstop `DeleteTransactionUseCase` documents for `softDelete`'s `null` return. */
export interface DebtNoLongerOpenOutcome {
  kind: 'debt_no_longer_open';
}

export type LogDebtRepaymentOutcome =
  | DebtRepaidOutcome
  | RepaymentCounterpartyAmbiguousOutcome
  | NoMatchingDebtOutcome
  | DebtMatchAmbiguousOutcome
  | OverpaymentConfirmationRequiredOutcome
  | DebtNoLongerOpenOutcome;

@Injectable()
export class LogDebtRepaymentUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CURRENCY_REPOSITORY) private readonly currencyRepository: CurrencyRepository,
    @Inject(COUNTERPARTY_REPOSITORY)
    private readonly counterpartyRepository: CounterpartyRepository,
    @Inject(DEBT_REPOSITORY) private readonly debtRepository: DebtRepository,
  ) {}

  async execute(input: LogDebtRepaymentInput): Promise<LogDebtRepaymentOutcome> {
    const user = await this.userRepository.findById(input.userId);
    if (!user) {
      throw new UserNotFoundError(input.userId);
    }

    const currencySupported = await this.currencyRepository.isSupported(input.currency);
    if (!currencySupported) {
      throw new InvalidCurrencyError(input.currency);
    }

    const existingCounterparties = await this.counterpartyRepository.findAllByUserId(input.userId);
    const match = matchCounterparty(input.counterpartyName, existingCounterparties);

    if (match.outcome === 'ambiguous') {
      return {
        kind: 'counterparty_ambiguous',
        candidates: match.candidates,
        message: generateCounterpartyAmbiguityMessage(match.candidates, input.language),
      };
    }
    if (match.outcome === 'new') {
      // A brand-new counterparty (no existing record at all) cannot have
      // any open debt to repay.
      return {
        kind: 'no_matching_debt',
        message: generateNoMatchingDebtMessage(input.counterpartyName, input.language),
      };
    }

    const expectedDebtDirection: DebtDirection =
      input.repaymentDirection === 'made' ? 'received' : 'given';

    // TASK-FIN-007 FX conversion is explicitly out of this task's scope —
    // a debt in a different currency than this repayment is never matched
    // here (never silently converted); it simply falls out of the
    // candidate pool, surfacing as `no_matching_debt` like any other
    // non-match. See this task's final report for this documented
    // limitation.
    const candidates = (
      await this.debtRepository.findOpenByCounterparty(
        input.userId,
        match.counterparty.id,
        expectedDebtDirection,
      )
    ).filter((debt) => debt.currency === input.currency);

    if (candidates.length === 0) {
      return {
        kind: 'no_matching_debt',
        message: generateNoMatchingDebtMessage(input.counterpartyName, input.language),
      };
    }
    if (candidates.length > 1) {
      return {
        kind: 'debt_ambiguous',
        candidates,
        message: generateRepaymentMatchAmbiguityMessage(candidates, input.language),
      };
    }

    const debt = candidates[0]!;
    let amountToApply = input.amount;
    let cappedFromOverpayment = false;
    try {
      // Pure pre-check (BR-DBT-001) — never silently applies an
      // overpayment. `logRepayment`'s own atomic conditional `UPDATE` is
      // the real, race-safe enforcement point; this is the primary UX path.
      debt.applyRepayment(input.amount);
    } catch (error) {
      if (!(error instanceof DebtOverpaymentError)) {
        throw error;
      }
      if (!input.confirmOverpayment) {
        return {
          kind: 'overpayment_confirmation_required',
          debt,
          attemptedAmount: input.amount,
          message: generateOverpaymentConfirmationMessage(
            input.amount,
            input.currency,
            debt.outstandingBalance,
            input.language,
          ),
        };
      }
      // Confirmed: cap at the outstanding balance so the debt settles
      // exactly at zero (BR-DBT-001 — never negative). The excess is not
      // tracked as a separate credit/reverse-debt — out of this task's
      // scope; the caller is expected to disclose this via
      // `cappedFromOverpayment` on the returned outcome.
      amountToApply = debt.outstandingBalance;
      cappedFromOverpayment = true;
    }

    const result = await this.debtRepository.logRepayment({
      debtId: debt.id,
      amount: amountToApply,
      currency: input.currency,
      repaymentDate: input.repaymentDate,
      originalText: input.originalText,
    });

    if (result === null) {
      return { kind: 'debt_no_longer_open' };
    }

    return {
      kind: 'repaid',
      debt: result.debt,
      repayment: result.repayment,
      cappedFromOverpayment,
    };
  }
}
