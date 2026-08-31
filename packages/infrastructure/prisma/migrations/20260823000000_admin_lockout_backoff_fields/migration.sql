-- ============================================================================
-- TASK-AUTH-002 — Admin Lockout/Backoff State (Additive)
-- ============================================================================
-- Adds the two columns `admins` needs to represent NFR-AUTH-004's exponential
-- backoff correctly (5 consecutive failures within a ROLLING 15-minute
-- window; the lockout duration itself grows 1/2/4/8/15 minutes across
-- repeated lockout cycles). Neither existing column can carry this state
-- without overloading it (see schema.prisma's own comment on each new
-- column): `failed_login_attempts`/`locked_until` alone cannot distinguish
-- "5 failures spread across a week" from "5 failures in 3 minutes", and
-- cannot remember which lockout cycle the account is currently on once a
-- lockout has already expired.
--
-- Purely additive — nullable / defaulted, no backfill, no rewrite of
-- existing rows' meaning, no drop — matching this schema's own additive-first
-- migration discipline (IMPLEMENTATION-BLUEPRINT.md §6, Chapter 13 §13.16).
-- ============================================================================

ALTER TABLE admins
    ADD COLUMN failed_login_window_started_at TIMESTAMPTZ,
    ADD COLUMN lockout_cycle_count INTEGER NOT NULL DEFAULT 0;
