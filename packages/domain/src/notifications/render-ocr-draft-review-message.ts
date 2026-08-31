import type { TransactionExtractionCandidate } from '../ai-extraction/transaction-extraction-schema';
import type { DetectedLanguage } from '../ai-extraction/transaction-extraction-schema';
import type { TelegramInlineKeyboard } from './telegram-inline-keyboard';

/**
 * TASK-AI-006 — the async, worker-produced counterpart to
 * `renderConfirmationMessage` (`apps/telegram-bot`'s own, for the
 * synchronous text-message turn). Deliberately lives here, in
 * `@afa/domain`, not in `apps/telegram-bot` — mirrors
 * `render-debt-notification-message.ts`'s established precedent exactly:
 * message rendering for an async `Notification` must be callable from
 * `ProcessReceiptImageUseCase` (`@afa/application`), which cannot depend on
 * an app package. Localized in all three supported languages, matching
 * this package's existing discipline (FR-NOT-011's precedent applied here).
 *
 * Deliberately never says "✅" or implies the record already exists — unlike
 * `renderConfirmationMessage`'s post-commit framing, this message describes
 * a still-pending draft awaiting the user's explicit Confirm tap.
 */
export function renderOcrDraftReviewMessage(
  candidate: TransactionExtractionCandidate,
  language: DetectedLanguage,
): string {
  const amountLine =
    candidate.amount !== null && candidate.currency !== null
      ? `${candidate.amount} ${candidate.currency}`
      : null;
  const parts = [amountLine, candidate.category, candidate.merchant, candidate.transactionDate]
    .filter((part): part is string => part !== null)
    .join(' — ');

  switch (language) {
    case 'uz':
      return `📷 Chekni o'qidim:\n${parts}\n\nTasdiqlaysizmi?`;
    case 'ru':
      return `📷 Прочитал чек:\n${parts}\n\nПодтверждаете?`;
    case 'en':
    default:
      return `📷 Read your receipt:\n${parts}\n\nConfirm?`;
  }
}

/** FR-OCR-006-style honest failure — the OCR/extraction pipeline could not produce a usable candidate at all. Never silent (AI-P6, fail closed). */
export function renderOcrExtractionFailedMessage(language: DetectedLanguage): string {
  switch (language) {
    case 'uz':
      return "📷 Kechirasiz, bu chekni o'qiy olmadim. Iltimos, ma'lumotlarni matn sifatida yozib yuboring.";
    case 'ru':
      return '📷 Извините, не удалось прочитать этот чек. Пожалуйста, напишите данные текстом.';
    case 'en':
    default:
      return "📷 Sorry, I couldn't read this receipt. Please type the details as text instead.";
  }
}

/**
 * TASK-AI-006 — the OCR draft review card's Confirm/Edit/Cancel keyboard.
 * Lives here (not `apps/telegram-bot`'s `confirmation-keyboard.ts`) because
 * it must be buildable from `ProcessReceiptImageUseCase` (`@afa/application`),
 * which cannot depend on an app package — same reasoning as
 * `renderOcrDraftReviewMessage` above. `ocrdraft_` callback_data prefix is
 * a deliberately separate namespace from `RouteCallbackQueryUseCase`'s own
 * `<action>:<id>[:<field>]` scheme (same precedent as `loan_wizard_`/
 * `search_`/`delacct_` in `telegram-bot.service.ts`) — a pre-commit draft
 * has no `AWAITING_CONFIRMATION` conversation-state entry to key off of,
 * and forcing one would risk clobbering whatever unrelated conversation
 * state the user's live text flow is in when this async card arrives.
 */
export function buildOcrDraftReviewKeyboard(
  draftId: string,
  language: DetectedLanguage,
): TelegramInlineKeyboard {
  const confirmLabel = { uz: '✅ Tasdiqlash', ru: '✅ Подтвердить', en: '✅ Confirm' }[language];
  const editLabel = { uz: '✏️ Tahrirlash', ru: '✏️ Изменить', en: '✏️ Edit' }[language];
  const cancelLabel = { uz: '❌ Bekor qilish', ru: '❌ Отменить', en: '❌ Cancel' }[language];

  return [
    [
      { text: confirmLabel, callback_data: `ocrdraft_confirm:${draftId}` },
      { text: editLabel, callback_data: `ocrdraft_edit:${draftId}` },
    ],
    [{ text: cancelLabel, callback_data: `ocrdraft_cancel:${draftId}` }],
  ];
}

/** The image was readable but no transaction-shaped content was found in it. */
export function renderOcrNoTransactionDetectedMessage(language: DetectedLanguage): string {
  switch (language) {
    case 'uz':
      return "📷 Bu rasmda tranzaksiya ma'lumotlarini topa olmadim.";
    case 'ru':
      return '📷 Не нашёл данные о транзакции на этом фото.';
    case 'en':
    default:
      return "📷 I couldn't find any transaction details in this photo.";
  }
}
