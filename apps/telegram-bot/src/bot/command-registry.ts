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
 * FR-BOT-009 (per-language localized descriptions) is not implemented here
 * — English-only descriptions, a documented simplification (see this
 * task's final report); the registration mechanism itself is real.
 */
export interface CommandDefinition {
  command: string;
  description: string;
}

export const COMMAND_DEFINITIONS: readonly CommandDefinition[] = [
  { command: 'start', description: 'Onboarding / welcome' },
  { command: 'help', description: 'List capabilities and example phrasings' },
  { command: 'report', description: 'Open report menu' },
  { command: 'dashboard', description: 'Quick-glance financial summary' },
  { command: 'budget', description: 'Budget management' },
  { command: 'debts', description: 'Debt overview' },
  { command: 'loans', description: 'Loan overview, creation, and payments' },
  { command: 'search', description: 'Search transactions' },
  { command: 'drafts', description: 'Pending/unfinished entries' },
  { command: 'export', description: 'Export your data' },
  { command: 'settings', description: 'Settings menu' },
  { command: 'undo', description: 'Undo last action' },
  { command: 'deleteaccount', description: 'Delete your account' },
  { command: 'cancel', description: 'Cancel any pending action' },
];

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
