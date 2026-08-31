import type { DetectedLanguage } from '../ai-extraction/transaction-extraction-schema';
import type { Counterparty } from '../entities/counterparty.entity';
import type { Debt } from '../entities/debt.entity';

/**
 * TASK-FIN-002 — reuses TASK-BOT-003's own established PATTERN (a pure,
 * localized-template function keyed by `DetectedLanguage`, never an LLM
 * call — FR-CE-001's "specific and single-purpose" applies just as much
 * here) for a DIFFERENT kind of ambiguity than that task's own
 * `generateClarificationQuestion` handles.
 *
 * `generateClarificationQuestion`/`selectClarificationField`
 * (`../conversation/`) answer "which required field is missing from an
 * AI-extracted `TransactionExtractionCandidate`?" — both are hard-coupled
 * to that candidate's own shape and field-name vocabulary (see their own
 * doc comments; `selectClarificationField` even casts to
 * `Record<string, unknown>` keyed by that schema's field names). Neither
 * can represent "here are 2 existing people named Aziz, which one?" or
 * "there are 3 open debts with Aziz, which one is this repayment for?" —
 * disambiguating AMONG EXISTING RECORDS, not selecting a missing field.
 * Extending them to do so would mean teaching the AI-extraction candidate
 * schema about debt-specific disambiguation, a materially larger change
 * than this task's approved scope (TASK-FIN-002 is structured-input debt
 * CRUD, mirroring `CreateExpenseUseCase`/`CreateIncomeUseCase` — no
 * natural-language/AI-extraction pipeline for debts exists yet). These
 * functions are the same architectural pattern, purpose-built for this
 * task's own kind of ambiguity instead — plain, localized strings the
 * application layer returns inside a structured outcome, for a caller
 * (e.g. `apps/telegram-bot`, a later integration) to display.
 */
export function generateCounterpartyAmbiguityMessage(
  candidates: readonly Counterparty[],
  language: DetectedLanguage,
): string {
  const names = candidates.map((counterparty) => counterparty.name).join(', ');
  switch (language) {
    case 'uz':
      return `Bir nechta shunga o'xshash ismlar topdim: ${names}. Qaysi biri, yoki bu boshqa odammi?`;
    case 'ru':
      return `Я нашёл несколько похожих имён: ${names}. Кто из них, или это другой человек?`;
    case 'en':
    default:
      return `I found a few similar names: ${names}. Which one, or is this someone else?`;
  }
}

function formatDebtOption(debt: Debt): string {
  const due = debt.dueDate ? ` (due ${debt.dueDate.toISOString().slice(0, 10)})` : '';
  return `${debt.outstandingBalance} ${debt.currency}${due}`;
}

export function generateRepaymentMatchAmbiguityMessage(
  candidates: readonly Debt[],
  language: DetectedLanguage,
): string {
  const counterpartyName = candidates[0]?.counterpartyName ?? '';
  const options = candidates.map(formatDebtOption).join('; ');
  switch (language) {
    case 'uz':
      return `${counterpartyName} bilan bir nechta ochiq qarz bor: ${options}. Qaysi birini yopyapsiz?`;
    case 'ru':
      return `С ${counterpartyName} есть несколько открытых долгов: ${options}. Какой из них вы закрываете?`;
    case 'en':
    default:
      return `There are multiple open debts with ${counterpartyName}: ${options}. Which one is this repayment for?`;
  }
}

export function generateNoMatchingDebtMessage(
  counterpartyName: string,
  language: DetectedLanguage,
): string {
  switch (language) {
    case 'uz':
      return `${counterpartyName} bilan hali ochiq qarz topilmadi.`;
    case 'ru':
      return `Открытый долг с ${counterpartyName} не найден.`;
    case 'en':
    default:
      return `I don't have an open debt with ${counterpartyName}.`;
  }
}

/** BR-DBT-001 — "overpayment requires confirmation": the message the application layer returns instead of silently applying (or silently rejecting) a repayment larger than the outstanding balance. */
export function generateOverpaymentConfirmationMessage(
  amount: string,
  currency: string,
  outstandingBalance: string,
  language: DetectedLanguage,
): string {
  switch (language) {
    case 'uz':
      return `${amount} ${currency} qoldiq ${outstandingBalance} ${currency} dan ko'p. Shunga qaramay davom etamizmi?`;
    case 'ru':
      return `${amount} ${currency} больше остатка ${outstandingBalance} ${currency}. Всё равно продолжить?`;
    case 'en':
    default:
      return `${amount} ${currency} is more than the outstanding balance of ${outstandingBalance} ${currency}. Apply it anyway?`;
  }
}
