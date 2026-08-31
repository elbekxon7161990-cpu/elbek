import type { DetectedLanguage } from '@afa/domain';
import type { InlineKeyboardMarkup } from 'telegraf/types';

/**
 * TASK-FIN-012 (Chapter 10 §10.3, FR-SCH-001 — "structured filter input ...
 * via a guided inline-keyboard flow"). Own, separate `search_*` callback_data
 * namespace, dispatched entirely outside `RouteCallbackQueryUseCase`'s
 * `<action>:<transactionId>[:<field>]` scheme (never modified here) —
 * mirrors `buildLoanWizardConfirmationKeyboard`'s own precedent for exactly
 * this situation (a guided flow that doesn't fit the Conversation Engine's
 * closed, guard-table-driven state machine). No financial values, no free
 * text, no secrets in callback_data — only field names/ids, the same rule
 * every existing keyboard builder in this file's sibling
 * `confirmation-keyboard.ts` already follows.
 */

function localize(template: Record<DetectedLanguage, string>, language: DetectedLanguage): string {
  return template[language];
}

const FILTER_FIELD_LABELS: Record<
  | 'category'
  | 'merchant'
  | 'transactionType'
  | 'dateFrom'
  | 'dateTo'
  | 'minAmount'
  | 'maxAmount'
  | 'tags',
  Record<DetectedLanguage, string>
> = {
  category: { uz: 'Kategoriya', ru: 'Категория', en: 'Category' },
  merchant: { uz: "Do'kon", ru: 'Магазин', en: 'Merchant' },
  transactionType: { uz: 'Turi', ru: 'Тип', en: 'Type' },
  dateFrom: { uz: 'Sanadan', ru: 'Дата с', en: 'Date from' },
  dateTo: { uz: 'Sanagacha', ru: 'Дата по', en: 'Date to' },
  minAmount: { uz: 'Min summa', ru: 'Мин. сумма', en: 'Min amount' },
  maxAmount: { uz: 'Maks summa', ru: 'Макс. сумма', en: 'Max amount' },
  tags: { uz: 'Teglar', ru: 'Теги', en: 'Tags' },
};

/**
 * FR-SCH-001's own filter list, plus Apply/Reset/Cancel — a checkmark on a
 * button whose filter is already set, per the standard "show current
 * selection state" affordance every guided-flow keyboard in this codebase
 * (the loan wizard, the budget flow) already uses in its own reply text.
 */
export function buildSearchFilterMenuKeyboard(
  activeFields: ReadonlySet<string>,
  language: DetectedLanguage,
): InlineKeyboardMarkup {
  const button = (field: keyof typeof FILTER_FIELD_LABELS, callback: string) => {
    const check = activeFields.has(field) ? '✅ ' : '';
    return { text: `${check}${FILTER_FIELD_LABELS[field][language]}`, callback_data: callback };
  };

  return {
    inline_keyboard: [
      [button('category', 'search_field:category'), button('merchant', 'search_field:merchant')],
      [button('transactionType', 'search_field:transactionType')],
      [button('dateFrom', 'search_field:dateFrom'), button('dateTo', 'search_field:dateTo')],
      [
        button('minAmount', 'search_field:minAmount'),
        button('maxAmount', 'search_field:maxAmount'),
      ],
      [button('tags', 'search_field:tags')],
      [
        {
          text: `🔍 ${localize({ uz: 'Qidirish', ru: 'Искать', en: 'Search' }, language)}`,
          callback_data: 'search_apply',
        },
      ],
      [
        {
          text: `♻️ ${localize({ uz: 'Tozalash', ru: 'Сбросить', en: 'Reset' }, language)}`,
          callback_data: 'search_reset',
        },
        {
          text: `✖️ ${localize({ uz: 'Bekor qilish', ru: 'Отмена', en: 'Cancel' }, language)}`,
          callback_data: 'search_cancel',
        },
      ],
    ],
  };
}

const TRANSACTION_TYPES = [
  'EXPENSE',
  'INCOME',
  'SALARY',
  'REFUND',
  'TRANSFER',
  'GOAL_CONTRIBUTION',
] as const;

/** A small, fixed enum — a dedicated quick-select keyboard is safer and clearer than free-text entry for this one field. */
export function buildSearchTypeKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: 'EXPENSE', callback_data: 'search_type:EXPENSE' },
        { text: 'INCOME', callback_data: 'search_type:INCOME' },
      ],
      [
        { text: 'SALARY', callback_data: 'search_type:SALARY' },
        { text: 'REFUND', callback_data: 'search_type:REFUND' },
      ],
      [
        { text: 'TRANSFER', callback_data: 'search_type:TRANSFER' },
        { text: 'GOAL_CONTRIBUTION', callback_data: 'search_type:GOAL_CONTRIBUTION' },
      ],
      [{ text: '⬅️', callback_data: 'search_menu' }],
    ],
  };
}

export function isSearchTransactionType(
  value: string,
): value is (typeof TRANSACTION_TYPES)[number] {
  return (TRANSACTION_TYPES as readonly string[]).includes(value);
}

/**
 * FR-SCH-003 — pagination + a per-result Delete action, reusing
 * `DeleteTransactionUseCase` (never a search-owned deletion path).
 * `search_delete:<transactionId>` is a NEW, ownership-checked-at-call-time
 * action, deliberately outside `parseCallbackData`'s own closed
 * conversation-scoped union (see this task's final report for why: that
 * scheme's `edit`/`undo` actions are staleness-checked against the
 * currently-pending `AWAITING_CONFIRMATION` context, not any arbitrary past
 * transaction — a genuinely different addressing model this callback never
 * pretends to be part of).
 */
export function buildSearchResultsKeyboard(
  transactionIds: readonly string[],
  page: number,
  hasNextPage: boolean,
  hasPreviousPage: boolean,
  language: DetectedLanguage,
): InlineKeyboardMarkup {
  const deleteLabel = localize({ uz: 'O‘chirish', ru: 'Удалить', en: 'Delete' }, language);
  const deleteRows = transactionIds.map((id, i) => [
    { text: `${i + 1}. 🗑 ${deleteLabel}`, callback_data: `search_delete:${id}` },
  ]);

  const navRow = [];
  if (hasPreviousPage) {
    navRow.push({ text: '⬅️', callback_data: `search_page:${page - 1}` });
  }
  navRow.push({
    text: `⬅️ ${localize({ uz: 'Filtrlar', ru: 'Фильтры', en: 'Filters' }, language)}`,
    callback_data: 'search_menu',
  });
  if (hasNextPage) {
    navRow.push({ text: '➡️', callback_data: `search_page:${page + 1}` });
  }

  return { inline_keyboard: [...deleteRows, navRow] };
}
