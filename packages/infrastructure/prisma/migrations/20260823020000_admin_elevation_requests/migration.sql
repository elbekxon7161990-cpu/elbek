-- ============================================================================
-- TASK-AUTH-005 — Admin Elevation Requests (Additive)
-- ============================================================================
-- Persistence for the `admin` -> `super_admin` elevation-approval flow
-- (Chapter 16 §16.10, FR-SEC-001-005, BR-SEC-001, AC-SEC-001). Purely
-- additive: one new table, two new virtual relation fields on `admins`
-- (no physical column change to `admins` itself), no existing column
-- altered or dropped — matching this schema's additive-first migration
-- discipline (IMPLEMENTATION-BLUEPRINT.md §6, Chapter 13 §13.16), same as
-- the AUTH-002 lockout/backoff migration before it.
--
-- Pending-state model: `resolved_at IS NULL AND expires_at > now()` is an
-- "active row" lookup, the same shape `admin_sessions`/`api_tokens` already
-- use. `expires_at`'s exact duration is a disclosed judgment call (not
-- PRD-specified), mirroring TASK-AUTH-002's own `ADMIN_MFA_CHALLENGE_TTL_MS`
-- precedent for a short, two-human real-time coordination step.
--
-- NOT modeled on `audit_log`: this row is mutated exactly once (the atomic
-- resolve, inside the same transaction as the role grant + the audit_log
-- INSERT it is transactionally coupled to) — `audit_log`'s own
-- INSERT/SELECT-only DB-role restriction would not permit that UPDATE, so a
-- separate, ordinarily-mutable table is the correct shape, not a misuse of
-- the immutable audit table.
-- ============================================================================

CREATE TABLE admin_elevation_requests (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_admin_id           UUID NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at                       TIMESTAMPTZ NOT NULL,
    resolved_at                          TIMESTAMPTZ,
    resolved_by_admin_id                     UUID REFERENCES admins(id) ON DELETE RESTRICT
);

CREATE INDEX idx_admin_elevation_requests_target_resolved
    ON admin_elevation_requests (target_admin_id, resolved_at);

-- This table is genuinely mutable (the atomic resolve), unlike `audit_log` —
-- full SELECT/INSERT/UPDATE/DELETE, same as `admin_sessions`/`api_tokens`.
-- Postgres's `GRANT ... ON ALL TABLES IN SCHEMA` from the init migration does
-- NOT retroactively cover a table created in a later migration — this grant
-- is required, not defensive boilerplate; omitting it would leave the live
-- `app_user`-authenticated connection unable to read or write this table at
-- all.
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_elevation_requests TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_elevation_requests TO app_admin;

-- ============================================================================
-- End of migration.
-- ============================================================================
