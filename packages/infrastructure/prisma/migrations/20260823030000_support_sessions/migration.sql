-- ============================================================================
-- TASK-SEC-006 — Support Sessions (Additive)
-- ============================================================================
-- Persistence for the justified/logged/time-bounded support-session flow
-- (Chapter 11 §11.2.6, §11.7.2 — FR-ADM-006/008/009/010). Purely additive:
-- two new tables, three new virtual relation fields (on `users`/`admins`,
-- no physical column change to either), no existing column altered or
-- dropped — matching this schema's additive-first migration discipline,
-- same as every prior migration this session.
--
-- `support_sessions`: the base Requested->Justified->Active lifecycle is
-- collapsed into one atomic creation (see schema.prisma's own comment on
-- why `Requested` is not separately persisted). `closed_at` (agent-ended)
-- and `expired_at` (worker-swept timeout) are deliberately distinct
-- columns so the audit trail can tell the two apart, per §11.2.8's edge
-- case ("session expires while still investigating... must be explicitly
-- re-opened, not silently extended").
--
-- `support_session_elevation_requests`: the Active->Elevated approval
-- flow. Deliberately a SEPARATE table from `admin_elevation_requests`
-- (TASK-AUTH-005) — that table performs a permanent Admin.role mutation;
-- this one performs a temporary, session-scoped, reversible transition.
-- Same architectural pattern (atomic conditional consume, transactionally
-- coupled with the audit_log write), different target.
-- ============================================================================

CREATE TABLE support_sessions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_admin_id         UUID NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
    target_user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    justification                   TEXT NOT NULL,
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at                              TIMESTAMPTZ NOT NULL,
    closed_at                                   TIMESTAMPTZ,
    expired_at                                      TIMESTAMPTZ
);

CREATE INDEX idx_support_sessions_agent_state
    ON support_sessions (agent_admin_id, closed_at, expired_at);
CREATE INDEX idx_support_sessions_target_user
    ON support_sessions (target_user_id);
CREATE INDEX idx_support_sessions_expiry_sweep
    ON support_sessions (expires_at, closed_at, expired_at);

CREATE TABLE support_session_elevation_requests (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    support_session_id         UUID NOT NULL REFERENCES support_sessions(id) ON DELETE RESTRICT,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at                          TIMESTAMPTZ NOT NULL,
    resolved_at                             TIMESTAMPTZ,
    resolved_by_admin_id                        UUID REFERENCES admins(id) ON DELETE RESTRICT,
    closed_at                                       TIMESTAMPTZ
);

CREATE INDEX idx_support_session_elevation_requests_session_state
    ON support_session_elevation_requests (support_session_id, resolved_at, closed_at);

-- Both tables are genuinely mutable (closing/resolving), unlike audit_log —
-- full SELECT/INSERT/UPDATE/DELETE, same as admin_sessions/api_tokens/
-- admin_elevation_requests. GRANT ON ALL TABLES from the init migration does
-- NOT retroactively cover tables created in a later migration — required,
-- not defensive boilerplate.
GRANT SELECT, INSERT, UPDATE, DELETE ON support_sessions TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON support_sessions TO app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON support_session_elevation_requests TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON support_session_elevation_requests TO app_admin;

-- ============================================================================
-- End of migration.
-- ============================================================================
