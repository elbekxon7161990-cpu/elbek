import { createHash } from 'node:crypto';

import type { CategoryAmount, DetectedLanguage, MerchantAmount } from '@afa/domain';
import type { InlineKeyboardMarkup } from 'telegraf/types';

/**
 * `/report` Telegram wiring — own, separate `report_*` callback_data
 * namespace, dispatched entirely outside `RouteCallbackQueryUseCase`'s own
 * `<action>:<transactionId>[:<field>]` scheme, same precedent as
 * `search_*`/`loan_wizard_*`/`delacct_*`/`ocrdraft_*` in `search-keyboard.ts`
 * and `confirmation-keyboard.ts`.
 *
 * These are the real 11 `reportType` discriminant values `GenerateReportUseCase`
 * itself returns (`generate-report.use-case.ts`) — not guessed or invented.
 */
export const REPORT_TYPES = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
  'cash_flow',
  'debt_summary',
  'category',
  'merchant',
  'custom_range',
  'trend_analysis',
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export function isReportType(value: string): value is ReportType {
  return (REPORT_TYPES as readonly string[]).includes(value);
}

/** Report types that generate immediately from `asOf = now` — no sub-menu. */
export const IMMEDIATE_REPORT_TYPES: readonly ReportType[] = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
  'debt_summary',
];

/** Report types that need a date range — offered as fixed 7/30/90-day presets rather than a new free-text date-entry flow (out of scope for this task). */
export const RANGE_REPORT_TYPES: readonly ReportType[] = [
  'cash_flow',
  'custom_range',
  'trend_analysis',
];

/** Report types that need a specific target (a category or a merchant), picked from the user's own recent data. */
export const PICKER_REPORT_TYPES: readonly ReportType[] = ['category', 'merchant'];

/** Preset lookback windows offered for range-needing report types (days). */
export const RANGE_PRESET_DAYS = [7, 30, 90] as const;

/** Fixed lookback window (days) used to source the category/merchant picker's own button list — same window then reused as the generated report's own range, so what the user picks from is exactly what gets reported on. */
export const PICKER_LOOKBACK_DAYS = 90;

/** Max picker buttons shown — keeps the menu on one screen and callback_data short. */
const MAX_PICKER_ENTRIES = 10;

const REPORT_TYPE_LABELS: Record<ReportType, Record<DetectedLanguage, string>> = {
  daily: { uz: '📅 Kunlik', ru: '📅 Дневной', en: '📅 Daily' },
  weekly: { uz: '🗓 Haftalik', ru: '🗓 Недельный', en: '🗓 Weekly' },
  monthly: { uz: '📆 Oylik', ru: '📆 Месячный', en: '📆 Monthly' },
  quarterly: { uz: '📊 Choraklik', ru: '📊 Квартальный', en: '📊 Quarterly' },
  yearly: { uz: '📈 Yillik', ru: '📈 Годовой', en: '📈 Yearly' },
  cash_flow: { uz: '💵 Pul oqimi', ru: '💵 Денежный поток', en: '💵 Cash flow' },
  debt_summary: { uz: '🤝 Qarzlar', ru: '🤝 Долги', en: '🤝 Debt summary' },
  category: { uz: '🏷 Kategoriya', ru: '🏷 Категория', en: '🏷 Category' },
  merchant: { uz: "🏪 Do'kon", ru: '🏪 Магазин', en: '🏪 Merchant' },
  custom_range: { uz: '🔢 Davr bo‘yicha', ru: '🔢 За период', en: '🔢 Custom range' },
  trend_analysis: { uz: '📉 Trend tahlili', ru: '📉 Анализ трендов', en: '📉 Trend analysis' },
};

function localize(template: Record<DetectedLanguage, string>, language: DetectedLanguage): string {
  return template[language];
}

/** All 11 real report types, 2 per row, plus a Cancel row. */
export function buildReportMenuKeyboard(language: DetectedLanguage): InlineKeyboardMarkup {
  const buttons = REPORT_TYPES.map((type) => ({
    text: REPORT_TYPE_LABELS[type][language],
    callback_data: `report_type:${type}`,
  }));

  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  rows.push([
    {
      text: `✖️ ${localize({ uz: 'Bekor qilish', ru: 'Отмена', en: 'Cancel' }, language)}`,
      callback_data: 'report_cancel',
    },
  ]);

  return { inline_keyboard: rows };
}

/** 7/30/90-day preset buttons for a range-needing report type, plus Back. */
export function buildReportRangePresetKeyboard(
  reportType: ReportType,
  language: DetectedLanguage,
): InlineKeyboardMarkup {
  const dayLabel = (days: number) =>
    localize(
      { uz: `Oxirgi ${days} kun`, ru: `Последние ${days} дн.`, en: `Last ${days} days` },
      language,
    );

  return {
    inline_keyboard: [
      RANGE_PRESET_DAYS.map((days) => ({
        text: dayLabel(days),
        callback_data: `report_range:${reportType}:${days}`,
      })),
      [
        {
          text: `⬅️ ${localize({ uz: 'Orqaga', ru: 'Назад', en: 'Back' }, language)}`,
          callback_data: 'report_back',
        },
      ],
    ],
  };
}

/** Deterministic short id for a merchant name — never the raw merchant text itself in callback_data (rule: short + deterministic, no arbitrary free text). Re-derived (never stored) by re-fetching the same picker window and matching this same hash at callback time. */
export function hashMerchant(merchant: string): string {
  return createHash('sha256').update(merchant).digest('hex').slice(0, 12);
}

/** `null` when there is nothing to pick from — caller shows the friendly empty-report reply instead of an empty menu. */
export function buildReportCategoryPickerKeyboard(
  categories: readonly CategoryAmount[],
  language: DetectedLanguage,
): InlineKeyboardMarkup | null {
  if (categories.length === 0) {
    return null;
  }
  const rows = categories
    .slice(0, MAX_PICKER_ENTRIES)
    .map((c) => [
      { text: `${c.categoryId} — ${c.totalAmount}`, callback_data: `report_cat:${c.categoryId}` },
    ]);
  rows.push([
    {
      text: `⬅️ ${localize({ uz: 'Orqaga', ru: 'Назад', en: 'Back' }, language)}`,
      callback_data: 'report_back',
    },
  ]);
  return { inline_keyboard: rows };
}

/** `null` when there is nothing to pick from — same convention as `buildReportCategoryPickerKeyboard`. */
export function buildReportMerchantPickerKeyboard(
  merchants: readonly MerchantAmount[],
  language: DetectedLanguage,
): InlineKeyboardMarkup | null {
  if (merchants.length === 0) {
    return null;
  }
  const rows = merchants.slice(0, MAX_PICKER_ENTRIES).map((m) => {
    const label = m.merchant.length > 28 ? `${m.merchant.slice(0, 27)}…` : m.merchant;
    return [
      {
        text: `${label} — ${m.totalAmount}`,
        callback_data: `report_mer:${hashMerchant(m.merchant)}`,
      },
    ];
  });
  rows.push([
    {
      text: `⬅️ ${localize({ uz: 'Orqaga', ru: 'Назад', en: 'Back' }, language)}`,
      callback_data: 'report_back',
    },
  ]);
  return { inline_keyboard: rows };
}

/** Shown under every generated report — the only "kerak bo'lsa Back" affordance the UX spec asks for. */
export function buildReportBackKeyboard(language: DetectedLanguage): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: `⬅️ ${localize({ uz: 'Hisobotlar menyusi', ru: 'Меню отчётов', en: 'Report menu' }, language)}`,
          callback_data: 'report_back',
        },
      ],
    ],
  };
}
