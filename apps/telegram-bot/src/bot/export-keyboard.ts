import type { DetectedLanguage } from '@afa/domain';
import type { InlineKeyboardMarkup } from 'telegraf/types';

/**
 * `/export` Telegram wiring (TASK-FIN-014, FR-EXP2-001) — own, separate
 * `export_*` callback_data namespace, same separate-namespace precedent as
 * `report_*`/`search_*`/`loan_wizard_*` (see `report-keyboard.ts`'s own doc
 * comment for the established reasoning).
 *
 * Only a date-range preset is offered — this task's own scope decision
 * (see its final report) keeps delivery synchronous-only, with no
 * category/transaction-type filter picker in this first cut (a disclosed
 * scope simplification versus FR-EXP2-001's full filter list, which
 * `/search`'s own richer filter menu already covers for read-only lookups).
 */
export const EXPORT_RANGE_PRESETS = [
  'this_month',
  'last_month',
  'last_90_days',
  'all_time',
] as const;
export type ExportRangePreset = (typeof EXPORT_RANGE_PRESETS)[number];

export function isExportRangePreset(value: string): value is ExportRangePreset {
  return (EXPORT_RANGE_PRESETS as readonly string[]).includes(value);
}

function localize(template: Record<DetectedLanguage, string>, language: DetectedLanguage): string {
  return template[language];
}

const PRESET_LABELS: Record<ExportRangePreset, Record<DetectedLanguage, string>> = {
  this_month: { uz: 'Shu oy', ru: 'Этот месяц', en: 'This month' },
  last_month: { uz: 'Oldingi oy', ru: 'Прошлый месяц', en: 'Last month' },
  last_90_days: { uz: 'Oxirgi 90 kun', ru: 'Последние 90 дней', en: 'Last 90 days' },
  all_time: { uz: 'Butun tarix', ru: 'Вся история', en: 'All time' },
};

export function buildExportMenuKeyboard(language: DetectedLanguage): InlineKeyboardMarkup {
  const buttons = EXPORT_RANGE_PRESETS.map((preset) => ({
    text: PRESET_LABELS[preset][language],
    callback_data: `export_range:${preset}`,
  }));

  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  rows.push([
    {
      text: `✖️ ${localize({ uz: 'Bekor qilish', ru: 'Отмена', en: 'Cancel' }, language)}`,
      callback_data: 'export_cancel',
    },
  ]);

  return { inline_keyboard: rows };
}
