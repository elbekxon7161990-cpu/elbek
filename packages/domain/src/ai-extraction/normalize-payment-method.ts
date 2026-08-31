import type { PaymentMethod } from '../entities/transaction.entity';

/**
 * TASK-AI-006 (OCR real-boot follow-up, final blocker #2) — real Claude
 * Vision receipt reads naturally report a payment method exactly as
 * printed on the receipt (often uppercase, e.g. a receipt's own "CASH"
 * stamp), while `structured-output-validator.ts`'s own `paymentMethod`
 * contract has always been case-sensitive against §13.4's real, five-value
 * DB CHECK constraint (`transaction.entity.ts`'s `PaymentMethod` type) —
 * rejecting every real Claude Vision extraction whose payment method wasn't
 * already lowercase. Normalizes at the validation boundary (not the
 * extraction prompt), same architectural pattern as
 * `normalize-transaction-time.ts`.
 *
 * `PAYMENT_METHODS` lives here (not duplicated in
 * `structured-output-validator.ts`, which imports it from here) — the one
 * canonical list, avoiding a circular import between this file and the
 * validator.
 *
 * Deliberately narrow, per this task's own explicit constraints: this is
 * CASE normalization only, checked against the five REAL enum values below
 * — never a semantic remapping. A raw value that isn't a case-insensitive
 * match for one of these five (e.g. "TRANSFER", "CLICK", "PAYME" — none of
 * which exist in the real `PaymentMethod` contract, whatever a receipt
 * happens to print) is rejected, exactly as before this fix; it is never
 * guessed into some "closest" valid value.
 */
export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'cash',
  'card',
  'bank_transfer',
  'mobile_wallet',
  'other',
];

/**
 * Returns the canonical (real, lowercase) `PaymentMethod` for `value` if it
 * case-insensitively matches one of `PAYMENT_METHODS`, or `null` if it does
 * not — the caller decides how to report that as a validation issue, same
 * contract shape as `normalizeTransactionTime`.
 */
export function normalizePaymentMethod(value: string): PaymentMethod | null {
  const lowered = value.toLowerCase();
  return (PAYMENT_METHODS as readonly string[]).includes(lowered)
    ? (lowered as PaymentMethod)
    : null;
}
