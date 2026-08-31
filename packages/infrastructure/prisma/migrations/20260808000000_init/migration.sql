-- ============================================================================
-- AI Personal Finance Assistant — Initial Schema Migration
-- ============================================================================
-- Source of truth: sections/13-database-design.md (Chapter 13), extended by
-- sections/16-security-compliance.md §16.4.2 (audit_log detail) and the
-- Engineering Execution Decisions disclosed in ../schema.prisma's header.
--
-- This file is the actual PostgreSQL schema of record. It supersedes
-- schema.prisma wherever Prisma's declarative DSL cannot express something
-- Chapter 13 requires: CHECK constraints, partial/filtered indexes, GIN
-- indexes, native range partitioning, and Row-Level Security. schema.prisma
-- remains the ORM/type-generation layer (FR-DB-026/027) consumed by
-- application code; this file is what actually runs against PostgreSQL.
--
-- Sequencing follows IMPLEMENTATION-BLUEPRINT.md §6's own instruction:
-- reference tables first, then users, then transactions and its dependents,
-- then budgets/debts/audit_log — one initial migration set, ordered by FK
-- dependency, not an unversioned single "initial schema" script pretending
-- migration discipline starts later.
--
-- PARTITIONING NOTE (user-confirmed resolution, see conversation record):
-- transactions, transaction_audit_log, and notifications are natively
-- partitioned per §13.12. Postgres requires every unique/PK constraint on a
-- partitioned table to include the partition column, so:
--   - transactions' real primary key is (id, transaction_date), not id alone
--   - the 4 tables that FK into transactions.id carry a denormalized
--     transaction_date column so their FK can target the composite key
--   - id remains globally unique in practice via UUID generation, not via a
--     Postgres-enforced single-column constraint on this one table
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- SECTION 1 — Reference Tables (§13.8)
-- ============================================================================

CREATE TABLE currencies (
    code            CHAR(3) PRIMARY KEY,
    symbol          TEXT,
    decimal_places  SMALLINT NOT NULL DEFAULT 2,
    is_active       BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE categories (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                    TEXT UNIQUE NOT NULL,
    parent_category_id      UUID REFERENCES categories(id) ON DELETE RESTRICT,
    default_type            TEXT NOT NULL CHECK (default_type IN ('expense','income','neutral')),
    icon                    TEXT,
    is_system               BOOLEAN NOT NULL DEFAULT true,
    owner_user_id           UUID, -- FK added after `users` exists (below)
    status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated')),
    replacement_category_id UUID REFERENCES categories(id) ON DELETE RESTRICT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE category_translations (
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    language    TEXT NOT NULL CHECK (language IN ('uz','ru','en')),
    label       TEXT NOT NULL,
    PRIMARY KEY (category_id, language)
);

CREATE TABLE fx_rates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    base_currency   CHAR(3) NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
    quote_currency  CHAR(3) NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
    rate            NUMERIC(18,8) NOT NULL,
    as_of_date      DATE NOT NULL,
    source          TEXT,
    UNIQUE (base_currency, quote_currency, as_of_date)
);

-- ============================================================================
-- SECTION 2 — users (§13.3)
-- ============================================================================

CREATE TABLE users (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id         BIGINT UNIQUE NOT NULL,
    telegram_username        TEXT,
    display_name             TEXT,
    preferred_language       TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('uz','ru','en')),
    default_currency         CHAR(3) NOT NULL DEFAULT 'UZS' REFERENCES currencies(code) ON DELETE RESTRICT,
    timezone                 TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deactivated','pending_deletion','deleted')),
    onboarding_completed_at  TIMESTAMPTZ,
    deletion_requested_at    TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_status ON users (status);

ALTER TABLE categories
    ADD CONSTRAINT fk_categories_owner_user FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT;

-- ============================================================================
-- SECTION 3 — Admin / Auth Support (§13.9, Chapter 16 §16.4.2, and the
-- disclosed Engineering Execution Decision for admin_sessions/api_tokens)
-- ============================================================================

CREATE TABLE admins (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                   TEXT UNIQUE NOT NULL,
    password_hash           TEXT NOT NULL,
    mfa_secret_ref           TEXT,
    role                        TEXT NOT NULL CHECK (role IN ('support_agent','admin','super_admin')),
    status                        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deactivated')),
    failed_login_attempts            INTEGER NOT NULL DEFAULT 0,
    locked_until                        TIMESTAMPTZ,
    created_at                             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_sessions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id            UUID NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
    token_hash            TEXT UNIQUE NOT NULL,
    parent_session_id       UUID REFERENCES admin_sessions(id) ON DELETE RESTRICT,
    ip_address                 INET,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at                          TIMESTAMPTZ NOT NULL,
    revoked_at                             TIMESTAMPTZ
);

CREATE INDEX idx_admin_sessions_admin_revoked ON admin_sessions (admin_id, revoked_at);

CREATE TABLE api_tokens (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_identifier        TEXT NOT NULL,
    token_type                  TEXT NOT NULL CHECK (token_type IN ('access','refresh')),
    token_hash                     TEXT UNIQUE NOT NULL,
    scope                             TEXT[] NOT NULL DEFAULT '{}',
    rate_limit_per_minute                INTEGER NOT NULL,
    parent_token_id                         UUID REFERENCES api_tokens(id) ON DELETE RESTRICT,
    expires_at                                 TIMESTAMPTZ NOT NULL,
    revoked_at                                    TIMESTAMPTZ,
    created_at                                       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_tokens_client ON api_tokens (client_identifier);
CREATE INDEX idx_api_tokens_expiry ON api_tokens (expires_at, revoked_at);

-- §16.4.2 — immutable, append-only. No application code path may UPDATE/DELETE
-- this table (enforced at the role-grant level in Section 9 below).
CREATE TABLE audit_log (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_type       TEXT NOT NULL CHECK (actor_type IN ('admin','support_agent','system','api_client')),
    actor_id            UUID REFERENCES admins(id) ON DELETE RESTRICT,
    action                 TEXT NOT NULL,
    target_user_id            UUID,
    target_resource              TEXT,
    justification                   TEXT,
    ip_address                         INET,
    metadata                              JSONB,
    created_at                               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_target_user ON audit_log (target_user_id);
CREATE INDEX idx_audit_log_actor ON audit_log (actor_id);

-- ============================================================================
-- SECTION 4 — accounts (§13.19.2)
-- ============================================================================

CREATE TABLE accounts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name                   TEXT NOT NULL,
    account_type              TEXT NOT NULL CHECK (account_type IN ('cash','bank_card','mobile_wallet','savings','other')),
    currency                     CHAR(3) NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
    starting_balance                NUMERIC(18,2) NOT NULL DEFAULT 0,
    is_default                         BOOLEAN NOT NULL DEFAULT false,
    status                                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    deleted_at                              TIMESTAMPTZ,
    created_at                                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_accounts_user_status ON accounts (user_id, status) WHERE deleted_at IS NULL;
-- §13.19.2 — at most one implicit default account per currency per user
CREATE UNIQUE INDEX uq_accounts_default_per_currency ON accounts (user_id, currency) WHERE is_default = true AND deleted_at IS NULL;

-- ============================================================================
-- SECTION 5 — savings_goals (§13.21.2) — created before transactions since
-- transactions.goal_id references it
-- ============================================================================

CREATE TABLE savings_goals (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name                       TEXT NOT NULL,
    target_amount                 NUMERIC(18,2) NOT NULL CHECK (target_amount > 0),
    currency                         CHAR(3) NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
    target_date                         DATE,
    status                                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
    last_milestone_fired                       INTEGER,
    deleted_at                                    TIMESTAMPTZ,
    created_at                                       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_savings_goals_user_status ON savings_goals (user_id, status) WHERE deleted_at IS NULL;

-- ============================================================================
-- SECTION 6 — transactions (§13.4, partitioned per §13.12; extended §13.19.3,
-- §13.21.3; FR-DB-002)
-- ============================================================================

CREATE TABLE transactions (
    id                          UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id                      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    transaction_type                TEXT NOT NULL CHECK (transaction_type IN (
        'EXPENSE','INCOME','SALARY','TRANSFER','INVESTMENT','SAVINGS','REFUND',
        'LOAN','INSTALLMENT','SUBSCRIPTION','CURRENCY_EXCHANGE','CASH_WITHDRAWAL',
        'BALANCE_ADJUSTMENT', -- FR-DB-001 (§13.19.4)
        'GOAL_CONTRIBUTION'   -- §13.21.3
    )),
    amount                              NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    currency                               CHAR(3) NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
    exchange_rate_to_default                  NUMERIC(18,8),
    category_id                                  UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    subcategory_id                                  UUID REFERENCES categories(id) ON DELETE RESTRICT,
    merchant                                           TEXT,
    payment_method                                        TEXT CHECK (payment_method IN ('cash','card','bank_transfer','mobile_wallet','other')),
    transaction_date                                         DATE NOT NULL,
    transaction_time                                            TIME,
    location                                                       TEXT,
    tags                                                              TEXT[] NOT NULL DEFAULT '{}',
    description                                                          TEXT NOT NULL,
    original_text                                                           TEXT NOT NULL,
    source_type                                                                TEXT NOT NULL CHECK (source_type IN ('text','voice','photo','pdf','excel','csv','screenshot','manual','api')),
    source_reference                                                              TEXT,
    confidence_scores                                                                JSONB,
    is_recurring_detected                                                               BOOLEAN NOT NULL DEFAULT false,
    linked_transaction_id                                                                  UUID,
    linked_transaction_date                                                                   DATE,
    created_by                                                                                   TEXT NOT NULL CHECK (created_by IN ('ai','user_manual','import','api')),
    deleted_at                                                                                      TIMESTAMPTZ,
    created_at                                                                                         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                                                                            TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- §13.19.3 extension
    account_id                UUID,
    source_account_id            UUID,
    destination_account_id          UUID,
    destination_amount                  NUMERIC(18,2),
    -- §13.21.3 extension
    goal_id                                UUID REFERENCES savings_goals(id) ON DELETE RESTRICT,
    -- Partitioned-table PK must include the partition column (transaction_date)
    PRIMARY KEY (id, transaction_date),
    -- FR-DB-002
    CONSTRAINT chk_transfer_distinct_accounts CHECK (transaction_type <> 'TRANSFER' OR source_account_id IS DISTINCT FROM destination_account_id)
) PARTITION BY RANGE (transaction_date);

ALTER TABLE transactions
    ADD CONSTRAINT fk_transactions_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_transactions_source_account FOREIGN KEY (source_account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_transactions_destination_account FOREIGN KEY (destination_account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_transactions_linked_transaction FOREIGN KEY (linked_transaction_id, linked_transaction_date) REFERENCES transactions(id, transaction_date) ON DELETE RESTRICT;

-- Default partition first, so any row outside the pre-created range is
-- rejected loudly into a visible catch-all rather than a failed INSERT with
-- no home — the partition-maintenance job (§13.12) is expected to keep the
-- real monthly partitions ahead of need; this is the disclosed defensive
-- backstop for the gap between "job runs" and "job fails silently" (§13.42.3).
CREATE TABLE transactions_default PARTITION OF transactions DEFAULT;

-- Initial partition set: 2026-01 through 2027-12 (24 months). The scheduled
-- job (§13.12) takes over pre-creating 2 months ahead from here on.
DO $$
DECLARE
    partition_start DATE := DATE '2026-01-01';
    partition_end   DATE;
    partition_name  TEXT;
BEGIN
    FOR i IN 0..23 LOOP
        partition_end := partition_start + INTERVAL '1 month';
        partition_name := 'transactions_' || TO_CHAR(partition_start, 'YYYY_MM');
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF transactions FOR VALUES FROM (%L) TO (%L)',
            partition_name, partition_start, partition_end
        );
        partition_start := partition_end;
    END LOOP;
END $$;

-- Indexes — created on the partitioned parent; Postgres propagates a
-- matching physical index to every existing and future partition.
CREATE INDEX idx_transactions_user_date ON transactions (user_id, transaction_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_user_category_date ON transactions (user_id, category_id, transaction_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_user_type ON transactions (user_id, transaction_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_tags_gin ON transactions USING GIN (tags);
CREATE INDEX idx_transactions_linked ON transactions (linked_transaction_id) WHERE linked_transaction_id IS NOT NULL;
-- FR-DB-022
CREATE INDEX idx_transactions_account_date ON transactions (account_id, transaction_date) WHERE deleted_at IS NULL;

-- ============================================================================
-- SECTION 7 — transaction_drafts (§13.5)
-- ============================================================================

CREATE TABLE transaction_drafts (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    partial_data                 JSONB NOT NULL,
    missing_fields                  TEXT[] NOT NULL,
    status                             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','abandoned','expired')),
    original_text                        TEXT NOT NULL,
    source_type                             TEXT NOT NULL,
    resolved_transaction_id                    UUID,
    resolved_transaction_date                     DATE,
    created_at                                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_interaction_at                                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at                                             TIMESTAMPTZ,
    CONSTRAINT fk_transaction_drafts_resolved FOREIGN KEY (resolved_transaction_id, resolved_transaction_date) REFERENCES transactions(id, transaction_date) ON DELETE RESTRICT
);

CREATE INDEX idx_transaction_drafts_user_status ON transaction_drafts (user_id, status, last_interaction_at);

-- ============================================================================
-- SECTION 8 — counterparties, debts, debt_repayments (§13.6)
-- ============================================================================

CREATE TABLE counterparties (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name          TEXT NOT NULL,
    aliases          TEXT[] NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE TABLE debts (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    direction                  TEXT NOT NULL CHECK (direction IN ('given','received')),
    counterparty_name             TEXT NOT NULL,
    counterparty_ref_id               UUID REFERENCES counterparties(id) ON DELETE RESTRICT,
    original_amount                      NUMERIC(18,2) NOT NULL CHECK (original_amount > 0),
    outstanding_balance                      NUMERIC(18,2) NOT NULL CHECK (outstanding_balance >= 0),
    currency                                    CHAR(3) NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
    transaction_date                               DATE NOT NULL,
    due_date                                          DATE,
    status                                               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','repaid','forgiven')),
    notes                                                   TEXT,
    original_text                                              TEXT NOT NULL,
    deleted_at                                                    TIMESTAMPTZ,
    created_at                                                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                                          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_debts_user_status_due ON debts (user_id, status, due_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_debts_user_counterparty ON debts (user_id, counterparty_ref_id);

CREATE TABLE debt_repayments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    debt_id         UUID NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
    amount            NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    currency             CHAR(3) NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
    repayment_date          DATE NOT NULL,
    original_text              TEXT NOT NULL,
    deleted_at                    TIMESTAMPTZ,
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- SECTION 9 — budgets, budget_notification_log (§13.7)
-- ============================================================================

CREATE TABLE budgets (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    scope_type                 TEXT NOT NULL CHECK (scope_type IN ('category','overall')),
    category_id                    UUID REFERENCES categories(id) ON DELETE RESTRICT,
    limit_amount                       NUMERIC(18,2) NOT NULL CHECK (limit_amount > 0),
    currency                              CHAR(3) NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
    period_type                              TEXT NOT NULL CHECK (period_type IN ('weekly','monthly','quarterly','yearly')),
    current_period_start                        DATE NOT NULL,
    current_period_end                             DATE NOT NULL,
    status                                            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
    deleted_at                                           TIMESTAMPTZ,
    created_at                                              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- §13.7 — category_id is NULL exactly when scope_type = 'overall'
    CONSTRAINT chk_budgets_scope_category CHECK (
        (scope_type = 'overall' AND category_id IS NULL) OR
        (scope_type = 'category' AND category_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_budgets_category_period ON budgets (user_id, category_id, period_type) WHERE deleted_at IS NULL AND scope_type = 'category';
CREATE UNIQUE INDEX uq_budgets_overall_period ON budgets (user_id, period_type) WHERE deleted_at IS NULL AND scope_type = 'overall';

CREATE TABLE budget_notification_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id         UUID NOT NULL REFERENCES budgets(id) ON DELETE RESTRICT,
    threshold_fired      INTEGER NOT NULL,
    period_start            DATE NOT NULL,
    fired_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (budget_id, threshold_fired, period_start)
);

-- ============================================================================
-- SECTION 10 — loans, loan_payments (§13.20)
-- ============================================================================

CREATE TABLE loans (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    lender                     TEXT NOT NULL,
    principal_amount               NUMERIC(18,2) NOT NULL CHECK (principal_amount > 0),
    outstanding_balance                NUMERIC(18,2) NOT NULL CHECK (outstanding_balance >= 0),
    currency                              CHAR(3) NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
    interest_rate                            NUMERIC(6,4),
    installment_amount                          NUMERIC(18,2) NOT NULL CHECK (installment_amount > 0),
    installment_frequency                          TEXT NOT NULL CHECK (installment_frequency IN ('weekly','monthly','quarterly')),
    start_date                                        DATE NOT NULL,
    status                                               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid_off')),
    deleted_at                                              TIMESTAMPTZ,
    created_at                                                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_loans_user_status ON loans (user_id, status) WHERE deleted_at IS NULL;

CREATE TABLE loan_payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id              UUID NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
    amount                  NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    principal_portion          NUMERIC(18,2) NOT NULL,
    payment_date                   DATE NOT NULL,
    created_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_loan_payments_loan_date ON loan_payments (loan_id, payment_date);

-- ============================================================================
-- SECTION 11 — recurring_templates, scheduled_transactions (§13.22)
-- ============================================================================

CREATE TABLE recurring_templates (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    template_data               JSONB NOT NULL,
    cadence                        TEXT NOT NULL CHECK (cadence IN ('weekly','monthly','quarterly','yearly')),
    next_occurrence_date               DATE NOT NULL,
    status                                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
    created_at                                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_recurring_templates_next_occurrence ON recurring_templates (next_occurrence_date) WHERE status = 'active';

CREATE TABLE scheduled_transactions (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    transaction_data             JSONB NOT NULL,
    scheduled_date                  DATE NOT NULL,
    resolved_transaction_id            UUID,
    resolved_transaction_date             DATE,
    created_at                               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_scheduled_transactions_resolved FOREIGN KEY (resolved_transaction_id, resolved_transaction_date) REFERENCES transactions(id, transaction_date) ON DELETE RESTRICT
);

CREATE INDEX idx_scheduled_transactions_date ON scheduled_transactions (scheduled_date) WHERE resolved_transaction_id IS NULL;

-- ============================================================================
-- SECTION 12 — transaction_audit_log (§13.9, extended FR-DB-012; partitioned
-- quarterly per §13.12)
-- ============================================================================

CREATE TABLE transaction_audit_log (
    id                UUID NOT NULL DEFAULT gen_random_uuid(),
    transaction_id      UUID NOT NULL,
    transaction_date       DATE NOT NULL,
    entity_table               TEXT NOT NULL DEFAULT 'transactions' CHECK (entity_table IN ('transactions','debts','budgets','accounts','loans','savings_goals')),
    field_name                     TEXT NOT NULL,
    old_value                         TEXT,
    new_value                            TEXT,
    changed_by                              TEXT NOT NULL CHECK (changed_by IN ('ai_original','user_edit','import','api','undo')),
    changed_at                                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, changed_at),
    CONSTRAINT fk_transaction_audit_log_transaction FOREIGN KEY (transaction_id, transaction_date) REFERENCES transactions(id, transaction_date) ON DELETE RESTRICT
) PARTITION BY RANGE (changed_at);

CREATE TABLE transaction_audit_log_default PARTITION OF transaction_audit_log DEFAULT;

DO $$
DECLARE
    partition_start DATE := DATE '2026-01-01';
    partition_end   DATE;
    partition_name  TEXT;
BEGIN
    FOR i IN 0..7 LOOP -- 8 quarters: 2026 Q1 – 2027 Q4
        partition_end := partition_start + INTERVAL '3 months';
        partition_name := 'transaction_audit_log_' || TO_CHAR(partition_start, 'YYYY') || '_q' || TO_CHAR(partition_start, 'Q');
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF transaction_audit_log FOR VALUES FROM (%L) TO (%L)',
            partition_name, partition_start, partition_end
        );
        partition_start := partition_end;
    END LOOP;
END $$;

CREATE INDEX idx_transaction_audit_log_txn_changed ON transaction_audit_log (transaction_id, changed_at);

-- ============================================================================
-- SECTION 13 — notifications (§13.9, partitioned monthly per §13.12)
-- ============================================================================

CREATE TABLE notifications (
    id           UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    type            TEXT NOT NULL,
    payload            JSONB NOT NULL,
    status                TEXT NOT NULL CHECK (status IN ('queued','sent','failed','suppressed')),
    sent_at                  TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE notifications_default PARTITION OF notifications DEFAULT;

DO $$
DECLARE
    partition_start DATE := DATE '2026-01-01';
    partition_end   DATE;
    partition_name  TEXT;
BEGIN
    FOR i IN 0..23 LOOP
        partition_end := partition_start + INTERVAL '1 month';
        partition_name := 'notifications_' || TO_CHAR(partition_start, 'YYYY_MM');
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF notifications FOR VALUES FROM (%L) TO (%L)',
            partition_name, partition_start, partition_end
        );
        partition_start := partition_end;
    END LOOP;
END $$;

-- ============================================================================
-- SECTION 14 — user_settings (§13.9)
-- ============================================================================

CREATE TABLE user_settings (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    setting_key       TEXT NOT NULL,
    setting_value        JSONB NOT NULL,
    PRIMARY KEY (user_id, setting_key)
);

-- ============================================================================
-- SECTION 15 — domain_events (§13.30 — transactional outbox, ADR-DB-001)
-- ============================================================================

CREATE TABLE domain_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type            TEXT NOT NULL,
    payload                  JSONB NOT NULL,
    status                      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','dispatched','failed')),
    dispatch_attempts              SMALLINT NOT NULL DEFAULT 0,
    created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
    dispatched_at                        TIMESTAMPTZ
);

CREATE INDEX idx_domain_events_pending ON domain_events (status, created_at) WHERE status = 'pending';

-- ============================================================================
-- SECTION 16 — user_financial_summary (§13.37 — maintained read model,
-- ADR-DB-003)
-- ============================================================================

CREATE TABLE user_financial_summary (
    user_id                         UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    net_worth_default_currency        NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_debt_outstanding               NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_loan_outstanding                  NUMERIC(18,2) NOT NULL DEFAULT 0,
    last_updated_at                            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- SECTION 17 — Row-Level Security (§13.35.2, FR-DB-020/021, ADR-DB-004)
-- ============================================================================
-- Session-variable convention (Engineering Execution Decision — not specified
-- by Chapter 13, which requires RLS exist but not its exact mechanism): the
-- application sets `app.current_user_id` via `SET LOCAL` at the start of
-- every request-scoped transaction. RLS here is defense-in-depth beneath the
-- application-layer check FR-AUTHZ-002 already requires (ADR-DB-004) — it is
-- never the only authorization layer.

-- LOGIN, no password set here — per FR-SCR-M-001/002 (Chapter 16 §16.6),
-- credentials never live in version-controlled migration SQL. Deploy
-- automation runs `ALTER ROLE ... WITH PASSWORD` from the secrets manager as
-- a separate, non-version-controlled post-migration step.
CREATE ROLE app_user LOGIN;
CREATE ROLE app_admin LOGIN BYPASSRLS; -- FR-DB-021 — distinct, non-RLS-bound role;
-- every access this role makes to individual user data must separately
-- produce an audit_log row per FR-ADM-008/FR-AUTHZ-003 — an application-layer
-- guarantee this role grant does not by itself provide.

-- Directly user_id-scoped tables
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transactions USING (user_id = current_setting('app.current_user_id', true)::uuid);

ALTER TABLE transaction_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transaction_drafts USING (user_id = current_setting('app.current_user_id', true)::uuid);

ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON debts USING (user_id = current_setting('app.current_user_id', true)::uuid);

ALTER TABLE counterparties ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON counterparties USING (user_id = current_setting('app.current_user_id', true)::uuid);

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON budgets USING (user_id = current_setting('app.current_user_id', true)::uuid);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounts USING (user_id = current_setting('app.current_user_id', true)::uuid);

ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON loans USING (user_id = current_setting('app.current_user_id', true)::uuid);

ALTER TABLE savings_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON savings_goals USING (user_id = current_setting('app.current_user_id', true)::uuid);

ALTER TABLE recurring_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recurring_templates USING (user_id = current_setting('app.current_user_id', true)::uuid);

ALTER TABLE scheduled_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scheduled_transactions USING (user_id = current_setting('app.current_user_id', true)::uuid);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications USING (user_id = current_setting('app.current_user_id', true)::uuid);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_settings USING (user_id = current_setting('app.current_user_id', true)::uuid);

ALTER TABLE user_financial_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_financial_summary USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- Indirectly-owned tables (no user_id column of their own — ownership flows
-- through their parent row)
ALTER TABLE debt_repayments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON debt_repayments USING (
    debt_id IN (SELECT id FROM debts WHERE user_id = current_setting('app.current_user_id', true)::uuid)
);

ALTER TABLE budget_notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON budget_notification_log USING (
    budget_id IN (SELECT id FROM budgets WHERE user_id = current_setting('app.current_user_id', true)::uuid)
);

ALTER TABLE loan_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON loan_payments USING (
    loan_id IN (SELECT id FROM loans WHERE user_id = current_setting('app.current_user_id', true)::uuid)
);

-- Explicit, not relied-on-by-default: PUBLIC's implicit schema privileges
-- have changed across Postgres versions (e.g. CREATE was revoked from PUBLIC
-- by default starting in PG15) — grant USAGE explicitly rather than depend
-- on whichever default a given Postgres version happens to ship.
GRANT USAGE ON SCHEMA public TO app_user, app_admin;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_admin;
-- FR-AUD immutability — neither role may UPDATE/DELETE audit_log; only the
-- (unrestricted, non-request-serving) migration/superuser role can, and only
-- for the retention-purge job's own audited system action (FR-DB-016).
REVOKE UPDATE, DELETE ON audit_log FROM app_user;
REVOKE UPDATE, DELETE ON audit_log FROM app_admin;

-- ============================================================================
-- End of initial migration.
-- ============================================================================
