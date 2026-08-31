import type { DetectedLanguage } from '@afa/domain';
import type { InlineKeyboardMarkup } from 'telegraf/types';

/**
 * TASK-AUTH-006 (Chapter 12 §12.18). Own, separate `delacct_*` callback_data
 * namespace, dispatched entirely outside `RouteCallbackQueryUseCase`'s own
 * scheme — mirrors `buildLoanWizardConfirmationKeyboard`/`search-keyboard.ts`'s
 * own already-established precedent for a flow that doesn't fit the
 * Conversation Engine's closed state machine. No financial values, no free
 * text, no secrets in callback_data.
 */

function localize(template: Record<DetectedLanguage, string>, language: DetectedLanguage): string {
  return template[language];
}

/** §12.18's own single-tap step 1: "[Yes, delete my account] [Cancel]". */
export function buildAccountDeletionConfirmKeyboard(
  language: DetectedLanguage,
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: `⚠️ ${localize(
            {
              uz: "Ha, hisobimni o'chirish",
              ru: 'Да, удалить аккаунт',
              en: 'Yes, delete my account',
            },
            language,
          )}`,
          callback_data: 'delacct_confirm',
        },
      ],
      [
        {
          text: `✖️ ${localize({ uz: 'Bekor qilish', ru: 'Отмена', en: 'Cancel' }, language)}`,
          callback_data: 'delacct_cancel',
        },
      ],
    ],
  };
}

/**
 * TASK-AUTH-006 — the "Cancel account deletion" button (distinct from
 * `/cancel`'s own conversation-cancellation semantics, and from
 * `delacct_cancel` above, which only declines the initial "type DELETE"
 * prompt before any deletion was ever requested). `delacct_cancel_pending`
 * is a fixed literal, never templated with a user id — the handler always
 * resolves the acting user via `requireCurrentUserId()` (ALS), never from
 * this callback_data, so a stale button from an old message can never
 * affect a different user. Shown both right after a successful deletion
 * request and on every repeated `/deleteaccount` status check.
 */
export function buildCancelPendingDeletionKeyboard(
  language: DetectedLanguage,
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: localize(
            {
              uz: "O'chirishni bekor qilish",
              ru: 'Отменить удаление',
              en: 'Cancel account deletion',
            },
            language,
          ),
          callback_data: 'delacct_cancel_pending',
        },
      ],
    ],
  };
}
