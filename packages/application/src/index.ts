/**
 * Application layer barrel. Populated starting with
 * ENGINEERING-TASK-BREAKDOWN.md Phase 3 (Authentication — TASK-AUTH-001);
 * further use-cases/dto/modules for Phase 4 onward follow the same shape:
 *   src/use-cases/    — one class per application use-case, depends only on
 *                        @afa/domain interfaces, injected via NestJS DI
 *                        tokens whose concrete binding lives in each
 *                        apps/* bootstrap
 *   src/dto/           — input/output shapes (class-validator-decorated
 *                         only where they cross an HTTP ValidationPipe)
 *   src/modules/         — NestJS modules exporting use-case providers,
 *                           imported by apps/api, apps/telegram-bot,
 *                           apps/worker as needed — never duplicated per app
 *
 * This package must never import from packages/infrastructure or any
 * NestJS platform/transport package (@nestjs/platform-express, telegraf,
 * bullmq) — only @nestjs/common for DI decorators.
 */

export * from './dto/provision-telegram-user.input';
export * from './use-cases/provision-telegram-user.use-case';
export * from './modules/auth.module';

export * from './dto/edit-transaction.input';
export * from './dto/delete-transaction.input';
export * from './dto/restore-transaction.input';
export * from './errors/application.error';
export * from './errors/invalid-category.error';
export * from './errors/invalid-currency.error';
export * from './errors/transaction-already-deleted.error';
export * from './errors/transaction-not-deleted.error';
export * from './errors/transaction-not-found.error';
export * from './errors/unauthorized-transaction-access.error';
export * from './errors/user-not-found.error';
export * from './errors/exchange-rate-unavailable.error';
export * from './use-cases/create-expense.use-case';
export * from './use-cases/create-income.use-case';
export * from './use-cases/edit-transaction.use-case';
export * from './use-cases/delete-transaction.use-case';
export * from './use-cases/restore-transaction.use-case';
export * from './use-cases/undo-last-transaction-action.use-case';
export * from './modules/finance.module';

// TASK-AI-001 — Structured Output Schema Validation.
export * from './use-cases/validate-structured-ai-output.use-case';

// TASK-AI-002 — Intent Classification & Entity Extraction.
export * from './use-cases/extract-transaction-candidates.use-case';

// TASK-AI-004 — Confidence Calibration & Evaluation Framework.
export * from './use-cases/run-calibration-evaluation.use-case';

// TASK-AI-005 — Speech-to-Text (STT) Worker.
export * from './use-cases/transcribe-voice-message.use-case';

// TASK-AI-006 — Receipt/Screenshot OCR Worker.
export * from './use-cases/process-receipt-image.use-case';

export * from './modules/ai-extraction.module';

// TASK-BOT-002 — Dialogue State Machine.
export * from './use-cases/process-conversation-event.use-case';
export * from './modules/conversation.module';

// TASK-BOT-001 — Bot Application Layer & Webhook Routing.
export * from './use-cases/route-text-message.use-case';
export * from './use-cases/route-callback-query.use-case';
export * from './use-cases/route-voice-message.use-case';
export * from './use-cases/route-photo-message.use-case';
export * from './use-cases/route-document-message.use-case';
export * from './use-cases/compute-current-date-time-in-timezone';
export * from './modules/bot-application.module';

// TASK-AI-006 (completion round) — OCR draft review Confirm/Edit/Cancel.
export * from './use-cases/route-ocr-draft-callback.use-case';

// TASK-FIN-REAL-001 — Real Transaction Commit Adapter.
export * from './errors/category-not-found.error';
export * from './errors/incomplete-transaction-candidate.error';
export * from './errors/transaction-commit-in-progress.error';
export * from './errors/unsupported-transaction-intent.error';
export * from './use-cases/transaction-commit.adapter';
export * from './modules/transaction-commit.module';

// TASK-BOT-004 — Confirmation Flow & Draft Persistence.
export * from './use-cases/list-drafts.use-case';

// FR-DB-015 — Domain-Event Dispatch Worker.
export * from './use-cases/dispatch-domain-events.use-case';
export * from './modules/domain-event-dispatch.module';

// TASK-REP-007 — Report Generation Architecture & Query Service.
export * from './use-cases/generate-report.use-case';
export * from './modules/generate-report.module';

// TASK-REP-004 — Dashboard Fast Path.
export * from './use-cases/generate-dashboard.use-case';
export * from './modules/generate-dashboard.module';

// TASK-FIN-014 — Export (Chapter 10 §10.2).
export * from './use-cases/export-transactions.use-case';
export * from './modules/export-transactions.module';

// TASK-BOT-SET — /settings (Chapter 7 §7.3/§7.4).
export * from './use-cases/update-user-profile.use-case';
export * from './use-cases/set-user-preference.use-case';
export * from './use-cases/get-user-settings-summary.use-case';
export * from './modules/user-settings.module';

// TASK-FIN-012 — Search (Chapter 10 §10.3).
export * from './use-cases/search-transactions.use-case';
export * from './modules/search-transactions.module';

// TASK-AUTH-006 — Account Deletion Flow (Chapter 12 §12.18, Chapter 16 §16.5.4).
export * from './use-cases/request-account-deletion.use-case';
export * from './use-cases/cancel-account-deletion.use-case';
export * from './use-cases/purge-expired-accounts.use-case';
export * from './modules/account-deletion.module';
export * from './modules/account-purge.module';

// Debt Reminder Producer task (FR-DBT-007).
export * from './use-cases/record-debt-reminder-events.use-case';
export * from './modules/debt-reminder-producer.module';

// TASK-FIN-002 — Debt Management (Chapter 8 §8.3).
export * from './errors/debt-not-found.error';
export * from './errors/debt-not-open.error';
export * from './errors/unauthorized-debt-access.error';
export * from './use-cases/create-debt.use-case';
export * from './use-cases/log-debt-repayment.use-case';
export * from './use-cases/settle-debt.use-case';
export * from './use-cases/list-open-debts.use-case';
export * from './modules/debt.module';

// TASK-FIN-003 — Budget System (Chapter 8 §8.4).
export * from './errors/budget-not-found.error';
export * from './errors/unauthorized-budget-access.error';
export * from './use-cases/create-budget.use-case';
export * from './use-cases/edit-budget.use-case';
export * from './use-cases/delete-budget.use-case';
export * from './use-cases/list-budgets.use-case';
export * from './use-cases/rollover-budget-periods.use-case';
export * from './modules/budget.module';
export * from './modules/budget-rollover-producer.module';

// TASK-FIN-007 Stage D — Account CRUD Use Cases (Chapter 8 §8.12).
export * from './errors/account-not-found.error';
export * from './errors/unauthorized-account-access.error';
export * from './use-cases/create-account.use-case';
export * from './use-cases/edit-account.use-case';
export * from './use-cases/delete-account.use-case';
export * from './use-cases/list-accounts.use-case';
export * from './modules/account.module';

// TASK-FIN-007 Stage F — FX Provider & Rate Ingestion (FR-INT-001/002/003).
export * from './use-cases/ingest-fx-rates.use-case';
export * from './modules/fx-rate-ingestion.module';

// TASK-FIN-004 Stage C — Transfer, Loan & Savings Goals (Chapter 8 §8.7-8.9).
export * from './errors/savings-goal-not-found.error';
export * from './errors/unauthorized-goal-access.error';
export * from './errors/missing-destination-amount.error';
export * from './use-cases/create-transfer.use-case';
export * from './modules/transfer.module';

// TASK-FIN-004 (FR-FIN-006) — Transfer edit/delete.
export * from './errors/invalid-destination-amount-edit.error';
export * from './errors/goal-linked-transfer-delete-not-supported.error';
export * from './use-cases/create-savings-goal.use-case';
export * from './use-cases/contribute-to-savings-goal.use-case';
export * from './modules/savings-goal.module';
export * from './use-cases/create-loan.use-case';
export * from './use-cases/list-open-loans.use-case';
export * from './modules/loan.module';

// TASK-FIN-004 Stage F — Loan Accounting (Chapter 8 §8.14.6).
export * from './errors/loan-not-found.error';
export * from './errors/unauthorized-loan-access.error';
export * from './use-cases/log-loan-payment.use-case';

// TASK-AUTH-002 — Admin Panel Password + Mandatory MFA (Chapter 7 §7.1.4, Chapter 16 §16.4.2).
export * from './dto/admin-login-password-step.input';
export * from './dto/admin-mfa-verify.input';
export * from './dto/bootstrap-admin.input';
export * from './errors/invalid-admin-credentials.error';
export * from './errors/invalid-admin-mfa-code.error';
export * from './errors/admin-session-invalid.error';
export * from './errors/admin-already-exists.error';
export * from './errors/weak-admin-password.error';
export * from './errors/breached-admin-password.error';
export * from './use-cases/apply-admin-login-failure';
export * from './use-cases/admin-login-password-step.use-case';
export * from './use-cases/admin-mfa-verification.use-case';
export * from './use-cases/validate-admin-session.use-case';
export * from './use-cases/bootstrap-admin.use-case';
export * from './modules/admin-auth.module';
export * from './modules/admin-bootstrap.module';

// TASK-AUTH-004 — Session Management Architecture (Chapter 16 §16.11).
export * from './use-cases/admin-logout.use-case';

// TASK-AUTH-003 — API Token Lifecycle (Chapter 7 §7.7.4, Chapter 14 §14.4/§14.15).
export * from './dto/issue-api-token.input';
export * from './dto/refresh-api-token.input';
export * from './errors/invalid-api-token-scope.error';
export * from './errors/api-token-not-found.error';
export * from './errors/invalid-refresh-token.error';
export * from './errors/api-token-invalid.error';
export * from './use-cases/issue-api-token.use-case';
export * from './use-cases/refresh-api-token.use-case';
export * from './use-cases/revoke-api-token.use-case';
export * from './use-cases/validate-api-token.use-case';
export * from './modules/api-token.module';

// TASK-AUTH-005 — RBAC Role Taxonomy & Elevation-Approval Architecture (Chapter 16 §16.10).
export * from './errors/admin-elevation-not-eligible.error';
export * from './errors/admin-elevation-request-invalid.error';
export * from './use-cases/request-admin-elevation.use-case';
export * from './use-cases/approve-admin-elevation.use-case';
export * from './modules/admin-elevation.module';

// TASK-FIN-006 — Custom Categories (Chapter 7 §7.4, Chapter 8 §8.11).
export * from './errors/invalid-parent-category.error';
export * from './errors/custom-category-not-found.error';
export * from './use-cases/create-custom-category.use-case';
export * from './use-cases/list-custom-categories.use-case';
export * from './use-cases/delete-custom-category.use-case';
export * from './modules/custom-category.module';

// TASK-SEC-006 — Admin Panel Core & Support-Session Access Flow (Chapter 11 §11.2/§11.7).
export * from './errors/support-session-invalid.error';
export * from './errors/support-session-elevation-invalid.error';
export * from './errors/support-session-target-user-not-found.error';
export * from './use-cases/open-support-session.use-case';
export * from './use-cases/validate-support-session.use-case';
export * from './use-cases/close-support-session.use-case';
export * from './use-cases/request-support-session-elevation.use-case';
export * from './use-cases/approve-support-session-elevation.use-case';
export * from './use-cases/close-support-session-elevation.use-case';
export * from './use-cases/require-elevated-support-session.use-case';
export * from './use-cases/list-my-support-sessions.use-case';
export * from './modules/support-session.module';
export * from './use-cases/expire-support-sessions.use-case';
export * from './modules/expire-support-sessions.module';

// Web admin panel (users, dashboard stats).
export * from './use-cases/list-users.use-case';
export * from './use-cases/get-user-by-id.use-case';
export * from './use-cases/block-user.use-case';
export * from './use-cases/unblock-user.use-case';
export * from './modules/admin-users.module';
export * from './use-cases/get-admin-dashboard-stats.use-case';
export * from './modules/admin-stats.module';
