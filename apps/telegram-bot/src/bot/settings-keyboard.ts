import type { CustomCategory, DetectedLanguage, SystemCategoryOption } from '@afa/domain';
import type { InlineKeyboardMarkup } from 'telegraf/types';

/**
 * `/settings` Telegram wiring (Chapter 7 §7.3/§7.4, FR-SET-001) — own,
 * separate `settings_*` callback_data namespace, same separate-namespace
 * precedent as `report_*`/`export_*`/`search_*` (see `report-keyboard.ts`'s
 * own doc comment for the established reasoning).
 *
 * §7.4.4's settings inventory has 8 rows; this menu covers 6 of them as
 * real, working submenus (Language, Default currency, Timezone,
 * Notification preferences, Confidence display, Custom categories —
 * TASK-FIN-006) plus 2 as redirects into their own already-real commands
 * (Data export → `/export`, Account deletion → `/deleteaccount`).
 * Subscription tier (FR-SET-005, added by the Billing module at §7.9.2) is
 * not shown at all — no Billing/subscription_tier concept exists anywhere in
 * this codebase yet, so there is nothing real to gate or display.
 */
function localize(template: Record<DetectedLanguage, string>, language: DetectedLanguage): string {
  return template[language];
}

const BACK_LABEL: Record<DetectedLanguage, string> = { uz: 'Orqaga', ru: 'Назад', en: 'Back' };
const CANCEL_LABEL: Record<DetectedLanguage, string> = {
  uz: 'Bekor qilish',
  ru: 'Отмена',
  en: 'Cancel',
};

export function buildSettingsMenuKeyboard(language: DetectedLanguage): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: `🌐 ${localize({ uz: 'Til', ru: 'Язык', en: 'Language' }, language)}`,
          callback_data: 'settings_lang',
        },
        {
          text: `💱 ${localize({ uz: 'Valyuta', ru: 'Валюта', en: 'Currency' }, language)}`,
          callback_data: 'settings_currency',
        },
      ],
      [
        {
          text: `🕐 ${localize({ uz: 'Vaqt zonasi', ru: 'Часовой пояс', en: 'Timezone' }, language)}`,
          callback_data: 'settings_timezone',
        },
        {
          text: `🔔 ${localize({ uz: 'Bildirishnomalar', ru: 'Уведомления', en: 'Notifications' }, language)}`,
          callback_data: 'settings_notif',
        },
      ],
      [
        {
          text: `👁 ${localize({ uz: 'Ishonch belgisi', ru: 'Индикатор доверия', en: 'Confidence display' }, language)}`,
          callback_data: 'settings_confidence',
        },
      ],
      [
        {
          text: `🏷 ${localize({ uz: "Maxsus kategoriyalar", ru: 'Свои категории', en: 'Custom categories' }, language)}`,
          callback_data: 'settings_categories',
        },
      ],
      [
        {
          text: `📤 ${localize({ uz: 'Eksport qilish', ru: 'Экспорт данных', en: 'Data export' }, language)}`,
          callback_data: 'settings_export',
        },
      ],
      [
        {
          text: `🗑 ${localize({ uz: "Hisobni o'chirish", ru: 'Удаление аккаунта', en: 'Delete account' }, language)}`,
          callback_data: 'settings_deleteaccount',
        },
      ],
      [{ text: `✖️ ${localize(CANCEL_LABEL, language)}`, callback_data: 'settings_cancel' }],
    ],
  };
}

const SETTINGS_LANGUAGE_LABELS: Record<'uz' | 'ru' | 'en', string> = {
  uz: "O'zbekcha",
  ru: 'Русский',
  en: 'English',
};

export function buildSettingsLanguageKeyboard(language: DetectedLanguage): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      (Object.keys(SETTINGS_LANGUAGE_LABELS) as Array<'uz' | 'ru' | 'en'>).map((code) => ({
        text: SETTINGS_LANGUAGE_LABELS[code],
        callback_data: `settings_lang_set:${code}`,
      })),
      [{ text: `⬅️ ${localize(BACK_LABEL, language)}`, callback_data: 'settings_back' }],
    ],
  };
}

/** Codes come from `CurrencyRepository.listActiveCodes()` — the real, seeded currency list, never a hardcoded/invented one. */
export function buildSettingsCurrencyKeyboard(
  codes: readonly string[],
  language: DetectedLanguage,
): InlineKeyboardMarkup {
  const buttons = codes.map((code) => ({
    text: code,
    callback_data: `settings_currency_set:${code}`,
  }));
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  rows.push([{ text: `⬅️ ${localize(BACK_LABEL, language)}`, callback_data: 'settings_back' }]);
  return { inline_keyboard: rows };
}

/**
 * A curated preset list, not the full ~400-zone IANA list (impractical as
 * inline buttons, and §7.4.1's own stated reason a menu exists at all —
 * "a menu is genuinely more efficient than typing" — argues for a short,
 * relevant list here, not free-text entry). A disclosed scope
 * simplification, see this task's final report.
 */
export const SETTINGS_TIMEZONE_PRESETS = [
  'Asia/Tashkent',
  'Asia/Almaty',
  'Asia/Bishkek',
  'Europe/Moscow',
  'Asia/Dubai',
  'Europe/London',
  'UTC',
] as const;

export function buildSettingsTimezoneKeyboard(language: DetectedLanguage): InlineKeyboardMarkup {
  const buttons = SETTINGS_TIMEZONE_PRESETS.map((timezone) => ({
    text: timezone,
    callback_data: `settings_timezone_set:${timezone}`,
  }));
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  rows.push([{ text: `⬅️ ${localize(BACK_LABEL, language)}`, callback_data: 'settings_back' }]);
  return { inline_keyboard: rows };
}

export interface SettingsNotificationState {
  readonly debtReminder: boolean;
  readonly budgetAlert: boolean;
}

/** The only 2 notification types with a real, already-wired producer/consumer today (`notif_debt_reminder`/`notif_budget_alert`) — the PRD's §7.9.4 matrix lists 4 more (loan/savings/weekly-summary/subscription) with no real event pipeline yet, so no toggle is offered for those (a disclosed gap, not an invented one). */
export function buildSettingsNotificationsKeyboard(
  state: SettingsNotificationState,
  language: DetectedLanguage,
): InlineKeyboardMarkup {
  const onOff = (enabled: boolean) => (enabled ? '✅' : '⬜️');
  return {
    inline_keyboard: [
      [
        {
          text: `${onOff(state.debtReminder)} ${localize({ uz: 'Qarz eslatmalari', ru: 'Напоминания о долгах', en: 'Debt reminders' }, language)}`,
          callback_data: 'settings_notif_toggle:debt_reminder',
        },
      ],
      [
        {
          text: `${onOff(state.budgetAlert)} ${localize({ uz: 'Byudjet ogohlantirishlari', ru: 'Оповещения о бюджете', en: 'Budget alerts' }, language)}`,
          callback_data: 'settings_notif_toggle:budget_alert',
        },
      ],
      [{ text: `⬅️ ${localize(BACK_LABEL, language)}`, callback_data: 'settings_back' }],
    ],
  };
}

export function buildSettingsConfidenceKeyboard(
  enabled: boolean,
  language: DetectedLanguage,
): InlineKeyboardMarkup {
  const onOff = enabled ? '✅' : '⬜️';
  return {
    inline_keyboard: [
      [
        {
          text: `${onOff} ${localize({ uz: 'Ishonch belgisini ko‘rsatish', ru: 'Показывать индикатор доверия', en: 'Show confidence flag' }, language)}`,
          callback_data: 'settings_confidence_toggle',
        },
      ],
      [{ text: `⬅️ ${localize(BACK_LABEL, language)}`, callback_data: 'settings_back' }],
    ],
  };
}

// ============================================================================
// TASK-FIN-006 — Custom Categories (Chapter 7 §7.4, Chapter 8 §8.11)
// ============================================================================

/** §7.9.6's worked example: List → Add new → Back. One row per existing custom category, tapping it opens the delete-preview (§7.4.7). */
export function buildCustomCategoriesListKeyboard(
  categories: readonly CustomCategory[],
  language: DetectedLanguage,
): InlineKeyboardMarkup {
  const categoryRows = categories.map((category) => [
    { text: `🗑 ${category.name}`, callback_data: `settings_categories_delete:${category.id}` },
  ]);
  return {
    inline_keyboard: [
      ...categoryRows,
      [
        {
          text: `➕ ${localize({ uz: "Qo'shish", ru: 'Добавить', en: 'Add new' }, language)}`,
          callback_data: 'settings_categories_add',
        },
      ],
      [{ text: `⬅️ ${localize(BACK_LABEL, language)}`, callback_data: 'settings_back' }],
    ],
  };
}

/** §7.9.6 step 4/5 — BR-SET-001's mandatory parent-system-category picker, shown after the name is typed and validated. */
export function buildCustomCategoryParentKeyboard(
  options: readonly SystemCategoryOption[],
  language: DetectedLanguage,
): InlineKeyboardMarkup {
  const buttons = options.map((option) => ({
    text: option.icon ? `${option.icon} ${option.label}` : option.label,
    callback_data: `settings_categories_parent:${option.code}`,
  }));
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  rows.push([
    { text: `✖️ ${localize(CANCEL_LABEL, language)}`, callback_data: 'settings_categories_cancel' },
  ]);
  return { inline_keyboard: rows };
}

/** §7.4.7/§11.7.6-mirrored delete preview — "the user is shown exactly which transactions were affected before the deletion is finalized." */
export function buildCustomCategoryDeleteConfirmKeyboard(
  categoryId: string,
  language: DetectedLanguage,
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: `🗑 ${localize({ uz: "O'chirish", ru: 'Удалить', en: 'Delete' }, language)}`,
          callback_data: `settings_categories_delete_confirm:${categoryId}`,
        },
        {
          text: `✖️ ${localize(CANCEL_LABEL, language)}`,
          callback_data: 'settings_categories_delete_cancel',
        },
      ],
    ],
  };
}

export function buildSettingsBackKeyboard(language: DetectedLanguage): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: `⬅️ ${localize({ uz: 'Sozlamalar menyusi', ru: 'Меню настроек', en: 'Settings menu' }, language)}`,
          callback_data: 'settings_back',
        },
      ],
    ],
  };
}
