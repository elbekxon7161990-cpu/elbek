import { divideDecimalAmountByInteger } from '../entities/decimal-amount';

/**
 * TASK-FIN-004 (Stage I) — Telegram UX collects `interestRate` from the
 * user as a whole-number-style PERCENTAGE (e.g. "12" meaning 12%, the
 * natural way a person types an interest rate), but `Loan.interestRate`'s
 * own contract (§13.20.3, corrected in this task's Stage F review
 * checkpoint) requires the decimal-FRACTION convention ("0.1200"). This is
 * the one, single conversion point — precision-safe (reuses the existing
 * BigInt-based `divideDecimalAmountByInteger`, never a JS-float `/100`) —
 * so no other Telegram-layer code needs to know this conversion exists.
 * Rounds to 4 decimal places, matching `interest_rate NUMERIC(6,4)`'s own
 * scale exactly.
 */
export function convertPercentToDecimalFraction(percent: string): string {
  return divideDecimalAmountByInteger(percent, 100, 4);
}
