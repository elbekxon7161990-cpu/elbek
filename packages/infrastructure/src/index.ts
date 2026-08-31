export * from './prisma/prisma.service';
export * from './prisma/prisma.module';

// TASK-DB-011 — request-scoped database user context for RLS.
export * from './prisma/rls-protected-models';
export * from './prisma/rls-context.extension';

export * from './redis/redis.constants';
export * from './redis/redis.module';
export * from './queue/queue.module';
export * from './repositories/prisma-user.repository';
export * from './repositories/user-repository.module';

// TASK-FIN-001 Part 3 — Expense & Income Management adapters.
export * from './repositories/transaction.mapper';
export * from './repositories/prisma-transaction.repository';
export * from './repositories/transaction-repository.module';
export * from './repositories/prisma-currency.repository';
export * from './repositories/currency-repository.module';
export * from './repositories/prisma-category.repository';
export * from './repositories/category-repository.module';
export * from './repositories/prisma-transaction-audit-log.repository';
export * from './repositories/transaction-audit-log-repository.module';

// TASK-FIN-001 final gap fix — FR-EXP-004 large-amount sanity check.
export * from './repositories/prisma-expense-history.repository';
export * from './repositories/expense-history-repository.module';

// TASK-INFRA-010 — External Provider Adapter Abstraction.
export * from './providers/retrying-llm-provider';
export * from './providers/circuit-breaker-llm-provider';
export * from './providers/fallback-llm-provider';
export * from './providers/fake-llm-provider';

// TASK-AI-005 — Speech-to-Text (STT) Worker.
export * from './providers/retrying-stt-provider';
export * from './providers/circuit-breaker-stt-provider';
export * from './providers/fallback-stt-provider';
export * from './providers/fake-stt-provider';
export * from './storage/fake-object-storage';
export * from './queue/stt-transcription.queue.module';

// TASK-AI-006 (Object Storage groundwork) — production Supabase Storage adapter.
export * from './storage/supabase-object-storage';
export * from './storage/object-storage.module';

// TASK-AI-006 — Receipt/Screenshot OCR Worker. Reuses `FakeObjectStorage` from TASK-AI-005 unchanged.
export * from './providers/retrying-ocr-provider';
export * from './providers/circuit-breaker-ocr-provider';
export * from './providers/fallback-ocr-provider';
export * from './providers/fake-ocr-provider';
export * from './queue/ocr-extraction.queue.module';

// TASK-AI-006 — real Anthropic Claude Vision OCR provider + composition root.
export * from './providers/anthropic-vision-ocr-provider';
export * from './providers/ocr-provider.module';

// TASK-BOT-002 — Dialogue State Machine.
export * from './conversation/redis-conversation-state.repository';
export * from './conversation/conversation-state-repository.module';
export * from './conversation/fake-conversation-state.repository';
export * from './conversation/fake-transaction-commit.repository';

// TASK-FIN-004 (Stage I) — Loan Telegram Wizard state.
export * from './conversation/redis-loan-wizard-state.repository';
export * from './conversation/loan-wizard-state-repository.module';

// TASK-BOT-001 — Bot Application Layer & Webhook Routing.
export * from './queue/bullmq-voice-transcription-queue.repository';
export * from './queue/voice-transcription-queue-repository.module';
export * from './queue/bullmq-ocr-extraction-queue.repository';
export * from './queue/ocr-extraction-queue-repository.module';

// TASK-INFRA-AI-REAL-001 — Real LLM Provider Adapter (Anthropic Claude).
export * from './providers/anthropic-llm-provider';
export * from './providers/llm-provider.module';

// TASK-FIN-REAL-001 — Real Transaction Commit Adapter.
export * from './repositories/redis-commit-idempotency-lock.repository';
export * from './repositories/fake-commit-idempotency-lock.repository';
export * from './repositories/commit-idempotency-lock-repository.module';

// TASK-BOT-004 — Confirmation Flow & Draft Persistence.
export * from './repositories/prisma-draft.repository';
export * from './repositories/draft-repository.module';

// TASK-DB-010 — Transactional-Outbox Event Storage.
export * from './repositories/prisma-domain-event.repository';
export * from './repositories/domain-event-repository.module';

// FR-DB-015 — Domain-Event Dispatch Worker.
export * from './events/map-domain-event-consumer-registry';
export * from './events/domain-event-consumer-registry.module';
export * from './queue/domain-event-dispatch.queue.module';

// TASK-DB-009 — Cache-Invalidation Hooks (FR-DB-025, FR-REP-009, FR-REP-010).
export * from './cache/redis-report-cache.repository';
export * from './cache/report-cache-repository.module';
export * from './events/transaction-event-cache-invalidation.consumer';

// TASK-REP-007 — Report Generation Architecture & Query Service.
export * from './repositories/prisma-report-query.repository';
export * from './repositories/report-query-repository.module';

// TASK-FIN-014 — Export (Chapter 10 §10.2).
export * from './repositories/prisma-export-query.repository';
export * from './repositories/export-query-repository.module';
export * from './xlsx/exceljs-xlsx-generator';
export * from './xlsx/xlsx-generator.module';

// TASK-FIN-002 — Debt Management (Chapter 8 §8.3).
export * from './repositories/debt.mapper';
export * from './repositories/prisma-counterparty.repository';
export * from './repositories/counterparty-repository.module';
export * from './repositories/prisma-debt.repository';
export * from './repositories/debt-repository.module';

// Debt Reminder Producer task (FR-DBT-007).
export * from './repositories/prisma-debt-reminder.repository';
export * from './repositories/debt-reminder-repository.module';
export * from './queue/debt-reminder-scan.queue.module';

// TASK-BOT-009 — Notification Delivery (Chapter 10 §10.1, §10.6).
export * from './repositories/notification.mapper';
export * from './repositories/prisma-notification.repository';
export * from './repositories/notification-repository.module';
export * from './repositories/prisma-notification-preference.repository';
export * from './repositories/notification-preference-repository.module';
export * from './repositories/prisma-notification-dedup.repository';
export * from './repositories/notification-dedup-repository.module';
export * from './queue/notification-delivery.queue.module';
export * from './queue/bullmq-notification-delivery.queue';

// TASK-BOT-SET — /settings (Chapter 7 §7.3/§7.4).
export * from './repositories/prisma-user-preference.repository';
export * from './repositories/user-preference-repository.module';
export * from './queue/notification-delivery-queue-repository.module';
export * from './events/notification-delivery.consumer';
export * from './notifications/telegraf-notification-sender';
export * from './notifications/null-notification-sender';

// TASK-FIN-003 — Budget System (Chapter 8 §8.4).
export * from './repositories/budget.mapper';
export * from './repositories/compute-budget-used-amount';
export * from './repositories/evaluate-budget-thresholds-on-expense-commit';
export * from './repositories/prisma-budget.repository';
export * from './repositories/budget-repository.module';
export * from './queue/budget-rollover.queue.module';

// TASK-FIN-007 (Stage B) — Accounts & Wallets (Chapter 8 §8.12).
export * from './repositories/account.mapper';
export * from './repositories/prisma-account.repository';
export * from './repositories/account-repository.module';

// TASK-FIN-007 (Stage G) — Account Balance (§8.14.2).
export * from './repositories/compute-account-balance';

// TASK-FIN-007 (Stage C) — Multi-Currency & FX Snapshot (Chapter 8 §8.13).
export * from './repositories/prisma-fx-rate.repository';
export * from './repositories/fx-rate-repository.module';

// TASK-FIN-007 (Stage F) — FX Provider & Rate Ingestion (FR-INT-001/002/003).
export * from './providers/fake-fx-rate-provider';
export * from './providers/fx-rate-provider.module';
export * from './queue/fx-rate-ingestion.queue.module';

// TASK-FIN-004 (Stage B) — Transfer, Loan & Savings Goals (Chapter 8 §8.7-8.9).
export * from './repositories/loan.mapper';
export * from './repositories/loan-payment.mapper';
export * from './repositories/prisma-loan.repository';
export * from './repositories/loan-repository.module';
export * from './repositories/savings-goal.mapper';
export * from './repositories/prisma-savings-goal.repository';
export * from './repositories/savings-goal-repository.module';

// TASK-FIN-004 (Stage E) — Savings Goal progress/milestone behavior (§8.14.5).
export * from './repositories/compute-savings-goal-progress';
export * from './repositories/evaluate-savings-goal-progress-on-contribution-commit';

// TASK-FIN-012 — Search (Chapter 10 §10.3).
export * from './conversation/redis-search-session.repository';
export * from './conversation/search-session-repository.module';

// TASK-AUTH-006 — Account Deletion Flow (Chapter 12 §12.18, Chapter 16 §16.5.4).
export * from './conversation/redis-account-deletion-confirmation.repository';
export * from './conversation/account-deletion-confirmation-repository.module';
export * from './repositories/prisma-account-purge.repository';
export * from './repositories/account-purge-repository.module';
export * from './queue/account-purge.queue.module';
export * from './queue/account-purge-notification.queue.module';
export * from './queue/bullmq-account-purge-notification.queue';
export * from './queue/account-purge-notification-queue-repository.module';

// TASK-AUTH-002 — Admin Panel Password + Mandatory MFA (Chapter 7 §7.1.4, Chapter 16 §16.4.2).
export * from './repositories/prisma-admin.repository';
export * from './repositories/admin-repository.module';
export * from './repositories/prisma-admin-session.repository';
export * from './repositories/admin-session-repository.module';
export * from './conversation/redis-admin-mfa-challenge.repository';
export * from './conversation/admin-mfa-challenge-repository.module';
export * from './auth/argon2-password-hasher';
export * from './auth/otplib-totp-provider';
export * from './auth/local-envelope-secret-store';
export * from './auth/fake-secret-store';
export * from './auth/no-op-breached-password-checker';
export * from './auth/fake-breached-password-checker';
export * from './auth/admin-auth-providers.module';

// TASK-AUTH-003 — API Token Lifecycle (Chapter 7 §7.7.4, Chapter 14 §14.4/§14.15).
export * from './repositories/prisma-api-token.repository';
export * from './repositories/api-token-repository.module';

// TASK-AUTH-005 — RBAC Role Taxonomy & Elevation-Approval Architecture (Chapter 16 §16.10).
export * from './repositories/prisma-audit-log.repository';
export * from './repositories/audit-log-repository.module';
export * from './repositories/prisma-admin-elevation.repository';
export * from './repositories/admin-elevation-repository.module';

// TASK-SEC-006 — Admin Panel Core & Support-Session Access Flow (Chapter 11 §11.2/§11.7).
export * from './repositories/prisma-support-session.repository';
export * from './repositories/support-session-repository.module';
export * from './repositories/prisma-support-session-elevation.repository';
export * from './repositories/support-session-elevation-repository.module';
export * from './queue/support-session-expiry.queue.module';

// TASK-FIN-006 — Custom Categories (Chapter 7 §7.4, Chapter 8 §8.11).
export * from './conversation/redis-custom-category-wizard-state.repository';
export * from './conversation/custom-category-wizard-state-repository.module';

/**
 * Further repository implementations (Chapter 13's tables → @afa/domain's
 * port interfaces) are added starting with ENGINEERING-TASK-BREAKDOWN.md
 * Phase 4, following the shape of ./repositories/prisma-user.repository.ts.
 */
