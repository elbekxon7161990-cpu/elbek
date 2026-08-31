import { TEXT_EDITABLE_FIELDS } from '@afa/application';
import type { DetectedLanguage } from '@afa/domain';
import type { InlineKeyboardMarkup } from 'telegraf/types';

/** TASK-BOT-008 (FR-CE-061) — short enough in all three languages to render on an inline-keyboard button without truncation. */
const FIELD_LABELS: Record<string, Record<DetectedLanguage, string>> = {
  amount: { uz: 'Summa', ru: 'Сумма', en: 'Amount' },
  merchant: { uz: "Do'kon", ru: 'Магазин', en: 'Merchant' },
  description: { uz: 'Tavsif', ru: 'Описание', en: 'Description' },
  location: { uz: 'Manzil', ru: 'Место', en: 'Location' },
};

function editButtonLabel(field: string, language: DetectedLanguage): string {
  const label = FIELD_LABELS[field]?.[language] ?? field;
  return `✏️ ${localize({ uz: 'Tahrirlash', ru: 'Изменить', en: 'Edit' }, language)} ${label}`;
}

function localize(template: Record<DetectedLanguage, string>, language: DetectedLanguage): string {
  return template[language];
}

/**
 * TASK-BOT-004 (FR-CE-013) — the Confirmation Renderer
 * `route-callback-query.use-case.ts`'s own doc comment names as not-yet-built.
 * Emits `<action>:<transactionId>[:<field>]` callback_data — the exact,
 * pre-existing scheme `parseCallbackData` already parses (TASK-BOT-001) —
 * and nothing else: no financial values, no free text, no secrets (per this
 * task's explicit "do NOT put financial text/secrets in callback_data").
 * TASK-BOT-008 — labels are localized (FR-CE-061); callback_data itself is
 * untouched (still only ids/field names, never translated or altered).
 *
 * Only offers an "Edit <field>" button for a flagged field that is also in
 * `TEXT_EDITABLE_FIELDS` — "only fields already supported by the current
 * edit architecture should be exposed." A flagged field like `category` or
 * `transactionDate` has no free-text edit path yet (see
 * `route-text-message.use-case.ts`'s own `EditFieldNotSupportedOutcome` doc
 * comment) and is deliberately not offered a button here, rather than
 * offering one that would dead-end.
 */
export function buildConfirmationKeyboard(
  transactionId: string,
  flaggedFields: readonly string[],
  language: DetectedLanguage,
): InlineKeyboardMarkup {
  const editableFlagged = flaggedFields.filter((field) => TEXT_EDITABLE_FIELDS.includes(field));

  const editButtons = editableFlagged.map((field) => ({
    text: editButtonLabel(field, language),
    callback_data: `edit:${transactionId}:${field}`,
  }));

  const undoButton = {
    text: `↩️ ${localize({ uz: 'Bekor qilish', ru: 'Отменить', en: 'Undo' }, language)}`,
    callback_data: `undo:${transactionId}`,
  };

  return {
    inline_keyboard: editButtons.length > 0 ? [editButtons, [undoButton]] : [[undoButton]],
  };
}

/**
 * TASK-BOT-006 (§5.7.1) — the Confirm/Skip pair for the one low-confidence
 * item currently at `AwaitingMultiItemReviewContext.currentIndex`. `draftId`
 * reuses `callbackData`'s existing id slot (see `parseCallbackData`'s own
 * doc comment) — never the batch id, so `RouteCallbackQueryUseCase` can
 * ownership-check the tap against the exact item still being reviewed.
 * "Cancel" reuses the pre-existing `cancel:<id>` action unchanged (it never
 * validates the id against any context) — no new callback-handling code was
 * needed for it. TASK-BOT-008 — labels localized (FR-CE-061).
 */
export function buildBatchReviewKeyboard(
  draftId: string,
  language: DetectedLanguage,
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: `✅ ${localize({ uz: 'Tasdiqlash', ru: 'Подтвердить', en: 'Confirm' }, language)}`,
          callback_data: `batch_confirm:${draftId}`,
        },
        {
          text: `⏭️ ${localize({ uz: "O'tkazib yuborish", ru: 'Пропустить', en: 'Skip' }, language)}`,
          callback_data: `batch_skip:${draftId}`,
        },
      ],
      [
        {
          text: `✖️ ${localize({ uz: 'Bekor qilish', ru: 'Отменить', en: 'Cancel' }, language)}`,
          callback_data: `cancel:${draftId}`,
        },
      ],
    ],
  };
}

/**
 * TASK-FIN-004 (Stage I) — Loan create/pay wizard confirmation. Deliberately
 * SEPARATE from `buildConfirmationKeyboard` (that one is tied to
 * `<action>:<transactionId>[:<field>]`, the Transaction-confirmation
 * domain) — this callback_data carries `loan_wizard_<kind>_<confirm|cancel>:<version>`.
 * The wizard record's own `version` is the idempotency guard: after the
 * first tap is processed, the wizard record is cleared/advanced, so a
 * duplicate tap's `version` no longer matches and is safely rejected as
 * stale (see `TelegramBotService`'s own callback handler) — no separate
 * idempotency-key table needed.
 */
export function buildLoanWizardConfirmationKeyboard(
  kind: 'create' | 'pay',
  version: number,
  language: DetectedLanguage,
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: `✅ ${localize({ uz: 'Tasdiqlash', ru: 'Подтвердить', en: 'Confirm' }, language)}`,
          callback_data: `loan_wizard_${kind}_confirm:${version}`,
        },
        {
          text: `✖️ ${localize({ uz: 'Bekor qilish', ru: 'Отменить', en: 'Cancel' }, language)}`,
          callback_data: `loan_wizard_${kind}_cancel:${version}`,
        },
      ],
    ],
  };
}

/** TASK-BOT-006 (FR-CE-031) — attached to the summary-first message; omitted entirely when there are no high-confidence items to offer (see caller). TASK-BOT-008 — localized (FR-CE-061), still short enough for one line in all three languages. */
export function buildBatchSummaryKeyboard(
  batchId: string,
  highConfidenceCount: number,
  language: DetectedLanguage,
): InlineKeyboardMarkup {
  const text = localize(
    {
      uz: `📥 ${highConfidenceCount} ta ishonchlisini hozir import qilish`,
      ru: `📥 Импортировать уверенных: ${highConfidenceCount}`,
      en: `📥 Import ${highConfidenceCount} confident one${highConfidenceCount === 1 ? '' : 's'} now`,
    },
    language,
  );
  return {
    inline_keyboard: [[{ text, callback_data: `batch_commit_high:${batchId}` }]],
  };
}
