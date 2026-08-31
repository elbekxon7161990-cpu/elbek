/**
 * Domain layer barrel. Populated starting with ENGINEERING-TASK-BREAKDOWN.md
 * Phase 3 (Authentication — TASK-AUTH-001); TASK-FIN-001 adds the Transaction
 * entity/port (Part 1) and the Currency/Category/TransactionAuditLog ports
 * Part 2's use cases need (Expense & Income Management). Further
 * entities/ports (Chapter 8's Debt, Budget, Loan, etc.) land the same way:
 * plain TS classes under src/entities/, ports under src/repositories/.
 *
 * This package must never import from packages/infrastructure, packages/
 * application, or any NestJS/Prisma/Redis package — see package.json's
 * description for the grounding (BR-SYS-002).
 */

export * from './entities/user.entity';
export * from './entities/transaction.entity';
export * from './entities/normalize-transaction-input';
export * from './errors/invalid-transaction.error';
export * from './repositories/user.repository';
export * from './repositories/transaction.repository';
export * from './repositories/currency.repository';
export * from './repositories/category.repository';
export * from './repositories/transaction-audit-log.repository';
export * from './repositories/expense-history.repository';

// TASK-INFRA-010 — External Provider Adapter Abstraction.
export * from './repositories/llm-provider.repository';
export * from './errors/llm-provider.error';
export * from './errors/llm-provider-authentication.error';
export * from './errors/llm-provider-rate-limit.error';
export * from './errors/llm-provider-timeout.error';
export * from './errors/llm-provider-unavailable.error';
export * from './errors/llm-provider-invalid-request.error';
export * from './errors/llm-provider-malformed-response.error';

// TASK-AI-001 — Structured Output Schema Validation.
export * from './ai-extraction/transaction-extraction-schema';
export * from './ai-extraction/structured-output-validator';
export * from './ai-extraction/normalize-transaction-time';
export * from './ai-extraction/normalize-payment-method';
export * from './errors/schema-validation.error';

// TASK-AI-002 — Intent Classification & Entity Extraction.
export * from './ai-extraction/extraction-context';
export * from './ai-extraction/extraction-prompt-template';
export * from './ai-extraction/apply-intent-confidence-threshold';
export * from './ai-extraction/intent-classification-evaluation';

// TASK-AI-003 — Hallucination-Prevention Layers.
export * from './ai-extraction/evaluate-field-grounding';
export * from './ai-extraction/apply-field-confidence-gating';
export * from './ai-extraction/evaluate-sanity-bounds';
export * from './ai-extraction/compute-record-confidence';
export * from './ai-extraction/apply-hallucination-prevention-layers';

// TASK-AI-004 — Confidence Calibration & Evaluation Framework.
export * from './ai-extraction/evaluation/evaluation-dataset';
export * from './ai-extraction/evaluation/confidence-calibration';
export * from './ai-extraction/evaluation/field-level-evaluation';
export * from './ai-extraction/evaluation/intent-evaluation';
export * from './ai-extraction/evaluation/record-level-evaluation';
export * from './ai-extraction/evaluation/threshold-analysis';
export * from './ai-extraction/evaluation/evaluation-run';
export * from './ai-extraction/evaluation/evaluation-report';

// TASK-AI-005 — Speech-to-Text (STT) Worker.
export * from './repositories/stt-provider.repository';
export * from './repositories/object-storage.repository';
export * from './errors/stt-provider.error';
export * from './errors/stt-provider-authentication.error';
export * from './errors/stt-provider-rate-limit.error';
export * from './errors/stt-provider-timeout.error';
export * from './errors/stt-provider-unavailable.error';
export * from './errors/stt-provider-invalid-audio.error';
export * from './errors/stt-provider-malformed-response.error';
export * from './errors/object-storage.error';
export * from './errors/object-not-found.error';
export * from './errors/object-storage-unavailable.error';
export * from './stt/evaluate-audio-validity';
export * from './stt/normalize-transcript';
export * from './stt/evaluate-transcript-confidence';
export * from './stt/voice-transcription-job';
export * from './stt/structured-transcription-result';

// TASK-AI-006 — Receipt/Screenshot OCR Worker. Reuses `ObjectStoragePort`/
// `OBJECT_STORAGE` from TASK-AI-005 unchanged — see repositories/object-storage.repository.ts above.
export * from './repositories/ocr-provider.repository';
export * from './errors/ocr-provider.error';
export * from './errors/ocr-provider-authentication.error';
export * from './errors/ocr-provider-rate-limit.error';
export * from './errors/ocr-provider-timeout.error';
export * from './errors/ocr-provider-unavailable.error';
export * from './errors/ocr-provider-invalid-image.error';
export * from './errors/ocr-provider-malformed-response.error';
export * from './ocr/evaluate-image-validity';
export * from './ocr/normalize-ocr-text';
export * from './ocr/extract-candidate-signals';
export * from './ocr/ocr-extraction-job';
export * from './ocr/structured-ocr-result';

// TASK-BOT-002 — Dialogue State Machine.
export * from './conversation/conversation-state';
export * from './conversation/conversation-events';
export * from './conversation/conversation-constants';
export * from './conversation/evaluate-conversation-transition';
export * from './conversation/is-conversation-state-expired';
export * from './conversation/is-cancellation-phrase';
export * from './repositories/conversation-state.repository';
export * from './repositories/transaction-commit.repository';

// TASK-BOT-001 — Bot Application Layer & Webhook Routing.
export * from './repositories/voice-transcription-queue.repository';
export * from './repositories/ocr-extraction-queue.repository';
export * from './input-processing/classify-document-upload';

// TASK-BOT-003 — Clarification Question Generator (Chapter 5 §5.14, §5.3.2).
// Replaces TASK-BOT-001's `selectFirstMissingRequiredField` placeholder.
export * from './conversation/select-clarification-field';
export * from './conversation/generate-clarification-question';

// TASK-FIN-REAL-001 — Real Transaction Commit Adapter.
export * from './repositories/commit-idempotency-lock.repository';

// TASK-BOT-004 — Confirmation Flow & Draft Persistence (Chapter 5 §5.4/§5.5, §13.5).
export * from './repositories/draft.repository';
export * from './drafts/is-draft-expired';

// TASK-BOT-005 — Interruption Handling & Command/Pending-State Matrix (Chapter 5 §5.6, §5.20).
export * from './conversation/classify-interruption';

// TASK-BOT-008 — Localization & Accessibility (Chapter 5 §5.21, Chapter 4 §4.2.2).
export * from './conversation/resolve-reply-language';

// TASK-DB-010 — Transactional-Outbox Event Storage (Chapter 8 §8.22, Chapter 13 §13.30).
export * from './events/domain-event';
export * from './repositories/domain-event.repository';

// FR-DB-015 — Domain-Event Dispatch Worker.
export * from './events/domain-event-consumer';

// TASK-DB-009 — Cache-Invalidation Hooks (FR-DB-025, FR-REP-009, FR-REP-010).
export * from './events/report-cache-period';
export * from './repositories/report-cache.repository';

// TASK-REP-007 — Report Generation Architecture & Query Service (transaction-aggregated report types).
export * from './reports/report-query-types';
export * from './reports/report-period-boundaries';
export * from './repositories/report-query.repository';

// TASK-FIN-014 — Export (Chapter 10 §10.2).
export * from './repositories/export-query.repository';
export * from './repositories/xlsx-generator.repository';

// TASK-FIN-002 — Debt Management (Chapter 8 §8.3).
export * from './entities/decimal-amount';
export * from './entities/calendar-date';
export * from './entities/counterparty.entity';
export * from './entities/debt-repayment.entity';
export * from './entities/debt.entity';
export * from './errors/invalid-debt.error';
export * from './errors/debt-overpayment.error';
export * from './debts/match-counterparty';
export * from './debts/generate-debt-clarification-message';
export * from './repositories/counterparty.repository';
export * from './repositories/debt.repository';

// Debt Reminder Producer task (FR-DBT-007, §8.22.2's DebtDueApproaching/DebtOverdue).
export * from './debts/classify-debt-reminder-condition';
export * from './repositories/debt-reminder.repository';

// TASK-REP-001 (remaining scope) — Debt Summary Report aging.
export * from './debts/compute-debt-overdue-days';

// TASK-BOT-009 — Notification Delivery (Chapter 10 §10.1, §10.6).
export * from './notifications/is-within-quiet-hours';
export * from './notifications/render-debt-notification-message';
export * from './notifications/telegram-notification-sender';
export * from './notifications/telegram-inline-keyboard';
export * from './errors/telegram-delivery-blocked.error';
export * from './repositories/notification.repository';
export * from './repositories/notification-preference.repository';
export * from './repositories/notification-dedup.repository';

// TASK-AI-006 — Receipt/Screenshot OCR Worker: real provider + draft/review hand-off.
export * from './notifications/render-ocr-draft-review-message';
export * from './repositories/notification-delivery-queue.repository';

// TASK-FIN-003 — Budget System (Chapter 8 §8.4).
export * from './entities/budget.entity';
export * from './errors/invalid-budget.error';
export * from './errors/duplicate-budget.error';
export * from './budgets/compute-budget-period-boundaries';
export * from './budgets/evaluate-budget-threshold-crossing';
export * from './budgets/match-budget-category-scope';
export * from './repositories/budget.repository';
export * from './notifications/render-budget-notification-message';

// TASK-FIN-007 (Stage B) — Accounts & Wallets (Chapter 8 §8.12).
export * from './entities/account.entity';
export * from './errors/invalid-account.error';
export * from './repositories/account.repository';

// TASK-FIN-007 (Stage G) — Account Balance (§8.14.2).
export * from './errors/account-balance-unavailable.error';

// TASK-FIN-007 (Stage C) — Multi-Currency & FX Snapshot (Chapter 8 §8.13).
export * from './errors/invalid-fx-rate.error';
export * from './repositories/fx-rate.repository';
export * from './currency/validate-new-fx-rate-data';

// TASK-FIN-007 (Stage F) — FX Provider & Rate Ingestion (Chapter 18 §18.1, FR-INT-001/002/003).
export * from './repositories/fx-rate-provider.repository';

// TASK-FIN-004 (Stage A) — Transfer, Loan & Savings Goals (Chapter 8 §8.7-8.9).
export * from './entities/loan.entity';
export * from './errors/invalid-loan.error';
export * from './entities/savings-goal.entity';
export * from './errors/invalid-savings-goal.error';
export * from './savings-goals/detect-newly-crossed-goal-milestones';

// TASK-FIN-004 (Stage B) — Loan/SavingsGoal repository ports.
export * from './repositories/loan.repository';
export * from './repositories/savings-goal.repository';

// TASK-FIN-004 (Stage E) — Savings Goal progress/milestone behavior (§8.14.5).
export * from './errors/goal-progress-unavailable.error';

// TASK-FIN-004 (Stage F) — Loan Accounting (§8.14.6).
export * from './errors/loan-overpayment.error';
export * from './errors/negative-amortization.error';
export * from './loans/compute-loan-amortization';
export * from './entities/loan-payment.entity';

// TASK-FIN-004 (Stage I) — Loan Telegram UX support (FR-FIN-009).
export * from './loans/calculate-next-loan-due-date';
export * from './loans/convert-percent-to-decimal-fraction';
export * from './loans/is-loan-wizard-state-expired';
export * from './entities/loan-wizard-state.entity';
export * from './repositories/loan-wizard-state.repository';

// TASK-FIN-008 — Financial Calculation Engine & Formula Library (§8.14-8.15).
export * from './errors/net-worth-unavailable.error';
export * from './errors/cash-flow-unavailable.error';
export * from './errors/full-cash-flow-unavailable.error';

// TASK-FIN-012 — Search (Chapter 10 §10.3).
export * from './entities/search-session.entity';
export * from './repositories/search-session.repository';
export * from './search/is-search-session-expired';

// TASK-AUTH-006 — Account Deletion Flow (Chapter 12 §12.18, Chapter 16 §16.5.4).
export * from './repositories/account-deletion-confirmation.repository';
export * from './users/account-deletion-grace-period';
export * from './repositories/account-purge.repository';
export * from './repositories/account-purge-notification-queue.repository';

// TASK-AUTH-002 — Admin Panel Password + Mandatory MFA (Chapter 7 §7.1.4, Chapter 16 §16.4.2).
export * from './entities/admin.entity';
export * from './entities/admin-session.entity';
export * from './repositories/admin.repository';
export * from './repositories/admin-session.repository';
export * from './repositories/admin-mfa-challenge.repository';
export * from './repositories/password-hasher.repository';
export * from './repositories/totp-provider.repository';
export * from './repositories/secret-store.repository';
export * from './repositories/breached-password-checker.repository';
export * from './auth/admin-lockout-constants';
export * from './auth/compute-admin-lockout-outcome';
export * from './auth/admin-session-constants';

// TASK-AUTH-003 — API Token Lifecycle (Chapter 7 §7.7.4, Chapter 14 §14.4/§14.15).
export * from './entities/api-token.entity';
export * from './repositories/api-token.repository';
export * from './auth/api-token-constants';
export * from './auth/is-valid-api-token-scope';

// TASK-AUTH-005 — RBAC Role Taxonomy & Elevation-Approval Architecture (Chapter 16 §16.10).
export * from './entities/audit-log-entry.entity';
export * from './repositories/audit-log.repository';
export * from './entities/admin-elevation-request.entity';
export * from './repositories/admin-elevation.repository';
export * from './auth/admin-elevation-constants';

// TASK-SEC-006 — Admin Panel Core & Support-Session Access Flow (Chapter 11 §11.2/§11.7).
export * from './entities/support-session.entity';
export * from './repositories/support-session.repository';
export * from './entities/support-session-elevation-request.entity';
export * from './repositories/support-session-elevation.repository';
export * from './auth/support-session-constants';

// TASK-BOT-SET — /settings (Chapter 7 §7.3/§7.4).
export * from './users/is-valid-iana-timezone';
export * from './repositories/user-preference.repository';

// TASK-FIN-006 — Custom Categories (Chapter 7 §7.4, Chapter 8 §8.11, BR-SET-001/FR-SET-003).
export * from './entities/custom-category.entity';
export * from './errors/invalid-custom-category.error';
export * from './errors/duplicate-category-name.error';
export * from './entities/custom-category-wizard-state.entity';
export * from './entities/is-custom-category-wizard-state-expired';
export * from './repositories/custom-category-wizard-state.repository';
