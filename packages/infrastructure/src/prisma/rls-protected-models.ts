/**
 * TASK-DB-011 — Prisma model names whose underlying table has an active
 * Row-Level Security policy, per
 * packages/infrastructure/prisma/migrations/20260808000000_init/migration.sql's
 * `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` section (verified 1:1 against
 * that section — 16 tables, mapped to their Prisma model name via each
 * model's `@@map` in schema.prisma), PLUS `Category`/`CategoryTranslation`
 * added by TASK-FIN-006's migration `20260830000000_custom_categories`
 * (a deliberately different, non-`tenant_isolation` policy shape — see that
 * migration's own comment for why: a `NULL` `owner_user_id` row, i.e. every
 * system category, must stay visible to every user, not just its "owner"):
 *
 *   transactions             -> Transaction
 *   transaction_drafts       -> TransactionDraft
 *   debts                    -> Debt
 *   counterparties           -> Counterparty
 *   budgets                  -> Budget
 *   accounts                 -> Account
 *   loans                    -> Loan
 *   savings_goals            -> SavingsGoal
 *   recurring_templates      -> RecurringTemplate
 *   scheduled_transactions   -> ScheduledTransaction
 *   notifications            -> Notification
 *   user_settings            -> UserSetting
 *   user_financial_summary   -> UserFinancialSummary
 *   debt_repayments          -> DebtRepayment
 *   budget_notification_log  -> BudgetNotificationLog
 *   loan_payments            -> LoanPayment
 *
 * Deliberately NOT included (no RLS policy on their table, verified by the
 * same section's absence of an `ENABLE ROW LEVEL SECURITY` line for them):
 * User, Currency, FxRate, TransactionAuditLog, Admin, AuditLog, AdminSession,
 * ApiToken, DomainEvent.
 *
 * If a future migration adds `ENABLE ROW LEVEL SECURITY` to a table not
 * listed here, this set must be updated in the same change — the Prisma
 * extension (./rls-context.extension.ts) only wraps queries against models
 * present in this set, so an omission here means RLS silently receives no
 * user context for that model's future traffic.
 */
export const RLS_PROTECTED_MODELS: ReadonlySet<string> = new Set([
  'Transaction',
  'TransactionDraft',
  'Debt',
  'Counterparty',
  'Budget',
  'Account',
  'Loan',
  'SavingsGoal',
  'RecurringTemplate',
  'ScheduledTransaction',
  'Notification',
  'UserSetting',
  'UserFinancialSummary',
  'DebtRepayment',
  'BudgetNotificationLog',
  'LoanPayment',
  'Category',
  'CategoryTranslation',
]);
