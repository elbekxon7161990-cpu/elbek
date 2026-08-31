import type { DebtReminderPayload, DebtSettledPayload } from '../events/domain-event';
import type { DetectedLanguage } from '../ai-extraction/transaction-extraction-schema';

/**
 * TASK-BOT-009 (FR-NOT-011) — every notification template localized in all
 * three supported languages, matching the identical discipline already
 * established for reports/clarification messages elsewhere in this
 * package. FR-NOT-005 — each message ends with a concrete next action
 * (Chapter 10's own worked example: "a debt reminder includes a 'Mark as
 * repaid' quick action") — the inline-button wiring itself is a Telegram-
 * layer (bot) concern; these functions produce only the message text.
 */
export function renderDebtDueApproachingMessage(
  payload: DebtReminderPayload,
  language: DetectedLanguage,
): string {
  switch (language) {
    case 'uz':
      return `Eslatma: ${payload.counterpartyName} bilan qarzingiz muddati (${payload.dueDate}) yaqinlashmoqda — ${payload.outstandingBalance} ${payload.currency}.`;
    case 'ru':
      return `Напоминание: срок долга с ${payload.counterpartyName} (${payload.dueDate}) приближается — ${payload.outstandingBalance} ${payload.currency}.`;
    case 'en':
    default:
      return `Reminder: your debt with ${payload.counterpartyName} is due ${payload.dueDate} — ${payload.outstandingBalance} ${payload.currency}.`;
  }
}

export function renderDebtOverdueMessage(
  payload: DebtReminderPayload,
  language: DetectedLanguage,
): string {
  switch (language) {
    case 'uz':
      return `Diqqat: ${payload.counterpartyName} bilan qarzingiz muddati (${payload.dueDate}) o'tib ketdi — ${payload.outstandingBalance} ${payload.currency}.`;
    case 'ru':
      return `Внимание: срок долга с ${payload.counterpartyName} (${payload.dueDate}) уже прошёл — ${payload.outstandingBalance} ${payload.currency}.`;
    case 'en':
    default:
      return `Overdue: your debt with ${payload.counterpartyName} was due ${payload.dueDate} — ${payload.outstandingBalance} ${payload.currency}.`;
  }
}

export function renderDebtSettledMessage(
  payload: DebtSettledPayload,
  language: DetectedLanguage,
): string {
  const settledWord =
    payload.status === 'forgiven'
      ? { uz: 'kechirib yuborildi', ru: 'прощён', en: 'forgiven' }
      : { uz: "to'liq to'landi", ru: 'полностью погашен', en: 'fully repaid' };
  switch (language) {
    case 'uz':
      return `${payload.counterpartyName} bilan qarzingiz ${settledWord.uz}.`;
    case 'ru':
      return `Долг с ${payload.counterpartyName} ${settledWord.ru}.`;
    case 'en':
    default:
      return `Your debt with ${payload.counterpartyName} is now ${settledWord.en}.`;
  }
}
