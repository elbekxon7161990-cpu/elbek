import type { DetectedLanguage } from '@afa/domain';

/**
 * TASK-BOT-001 (FR-BOT-001, §7.2.4's Command Inventory). Registration
 * (`setMyCommands`) covers all 13 commands so `/`-menu discoverability
 * (US-BOT-002) is complete on day one; `/start`, `/help`, `/cancel`
 * (TASK-BOT-001), `/drafts` (TASK-BOT-004, FR-CE-020), `/debts`
 * (TASK-FIN-002, FR-DBT-006), `/budget` (TASK-FIN-003, FR-BUD-006/007), and
 * `/dashboard` (TASK-REP-004, FR-DSH-001/002/004/005 — its own dedicated
 * Fast Path, deliberately independent of `/report`'s own module below), and
 * `/search` (TASK-FIN-012, FR-SCH-001/003/004 — structured filters only;
 * FR-SCH-002's natural-language search remains a documented STOP, see this
 * task's own final report), and `/deleteaccount` (TASK-AUTH-006,
 * FR-RET-001/003 — the request/confirm/grace-period-start flow only; the
 * scheduled hard-purge job itself, FR-RET-002, is a documented STOP pending
 * unresolved product decisions, see this task's own final report), and
 * `/report` (TASK-REP-TG — a Telegram-facing menu/callback flow wired
 * directly onto the already-existing `GenerateReportUseCase`, all 11 of its
 * real report types; see `telegram-bot.service.ts`'s own `handleReportCallback`
 * doc comment), and `/export` (TASK-FIN-014, FR-EXP2-001 — a real,
 * synchronous `.xlsx` export of the user's own transactions via
 * `ExportTransactionsUseCase`; FR-EXP2-003/004's own async-job/signed-URL
 * path for exports over 5,000 rows is a documented, disclosed gap, not
 * implemented here — see that task's own final report), and `/settings`
 * (TASK-BOT-SET, Chapter 7 §7.3/§7.4 — Language/Currency/Timezone via
 * `UpdateUserProfileUseCase`, notification toggles + confidence-display via
 * `SetUserPreferenceUseCase`, Data export/Account deletion as redirects into
 * the already-real `/export`/`/deleteaccount` flows; Custom categories
 * (FR-SET-003/BR-SET-001) is a documented, disclosed gap — no owning task
 * exists for it yet, see this task's own final report) have real handlers
 * wired — the rest (`/undo`) belongs to Chapter 10's not-yet-built module
 * and replies with a graceful placeholder rather than a reimplementation of
 * that module (out of scope). Note
 * `/undo` here is the registered top-level *command* (Chapter 10 scope,
 * still a placeholder) — distinct from TASK-BOT-004's inline-keyboard
 * "Undo" button on a confirmation message, which is real (see
 * `confirmation-keyboard.ts`). `/budget`'s creation path is a structured
 * command-argument flow (`/budget create <code|overall> <amount> <period>`),
 * NOT the full `IN_BUDGET_SETUP` conversation-state guided flow §5.2.1
 * describes — a disclosed scope simplification, see TASK-FIN-003's own
 * final report for the reasoning.
 *
 * FR-BOT-009 (per-language localized descriptions) — `descriptions` below
 * carries uz/ru/en text for every command, and `telegram-bot.service.ts`'s
 * `onModuleInit()` registers one `setMyCommands` call per
 * `DETECTED_LANGUAGES` entry (via `language_code`) plus one unscoped
 * default (English), matching this codebase's own `Record<DetectedLanguage,
 * string>` localization convention (`reply-messages.ts`'s `localize()`).
 * Telegram scopes this menu by the *Telegram client's own* language
 * setting, not by any preference stored in our own `users` table — a user
 * who changes language via `/settings` only changes their chat replies;
 * the "/" menu still follows their Telegram app's language.
 */
export interface CommandDefinition {
  command: string;
  descriptions: Record<DetectedLanguage, string>;
}

export const COMMAND_DEFINITIONS: readonly CommandDefinition[] = [
  {
    command: 'start',
    descriptions: { uz: 'Boshlash / xush kelibsiz', ru: 'Начало работы', en: 'Onboarding / welcome' },
  },
  {
    command: 'help',
    descriptions: {
      uz: "Imkoniyatlar va namuna so'zlar ro'yxati",
      ru: 'Список возможностей и примеров фраз',
      en: 'List capabilities and example phrasings',
    },
  },
  {
    command: 'report',
    descriptions: { uz: 'Hisobot menyusini ochish', ru: 'Открыть меню отчётов', en: 'Open report menu' },
  },
  {
    command: 'dashboard',
    descriptions: {
      uz: "Tezkor moliyaviy ko'rinish",
      ru: 'Краткая финансовая сводка',
      en: 'Quick-glance financial summary',
    },
  },
  {
    command: 'budget',
    descriptions: { uz: 'Byudjetni boshqarish', ru: 'Управление бюджетом', en: 'Budget management' },
  },
  {
    command: 'debts',
    descriptions: { uz: "Qarzlar ro'yxati", ru: 'Обзор долгов', en: 'Debt overview' },
  },
  {
    command: 'loans',
    descriptions: {
      uz: "Kreditlar: ko'rish, yaratish, to'lovlar",
      ru: 'Кредиты: обзор, создание, платежи',
      en: 'Loan overview, creation, and payments',
    },
  },
  {
    command: 'search',
    descriptions: {
      uz: 'Tranzaksiyalarni qidirish',
      ru: 'Поиск транзакций',
      en: 'Search transactions',
    },
  },
  {
    command: 'drafts',
    descriptions: {
      uz: "Kutilayotgan/tugallanmagan yozuvlar",
      ru: 'Незавершённые записи',
      en: 'Pending/unfinished entries',
    },
  },
  {
    command: 'export',
    descriptions: {
      uz: "Ma'lumotlaringizni eksport qilish",
      ru: 'Экспорт ваших данных',
      en: 'Export your data',
    },
  },
  {
    command: 'settings',
    descriptions: { uz: 'Sozlamalar menyusi', ru: 'Меню настроек', en: 'Settings menu' },
  },
  {
    command: 'undo',
    descriptions: {
      uz: 'Oxirgi amalni bekor qilish',
      ru: 'Отменить последнее действие',
      en: 'Undo last action',
    },
  },
  {
    command: 'deleteaccount',
    descriptions: { uz: "Hisobingizni o'chirish", ru: 'Удалить аккаунт', en: 'Delete your account' },
  },
  {
    command: 'cancel',
    descriptions: {
      uz: 'Joriy amalni bekor qilish',
      ru: 'Отменить текущее действие',
      en: 'Cancel any pending action',
    },
  },
];

/** Telegraf's `BotCommand` shape (`{ command, description }`) for one language, used by `setMyCommands`. */
export function localizedCommandList(
  language: DetectedLanguage,
): ReadonlyArray<{ command: string; description: string }> {
  return COMMAND_DEFINITIONS.map((definition) => ({
    command: definition.command,
    description: definition.descriptions[language],
  }));
}

/** Commands with a real handler in this task; every other registered command replies with `COMMAND_NOT_YET_AVAILABLE_REPLY`. */
export const IMPLEMENTED_COMMANDS: ReadonlySet<string> = new Set([
  'start',
  'help',
  'cancel',
  'drafts',
  'debts',
  'budget',
  'loans',
  'dashboard',
  'search',
  'deleteaccount',
  'report',
  'export',
  'settings',
  'undo',
]);
