/**
 * TASK-SEC-006 — how long a support session stays active before it must be
 * explicitly re-opened (§11.2.8: "must be explicitly re-opened (re-justified),
 * not silently extended"). Not PRD-specified; a disclosed judgment call,
 * same posture as TASK-AUTH-002's `ADMIN_MFA_CHALLENGE_TTL_MS` and
 * TASK-AUTH-005's `ADMIN_ELEVATION_REQUEST_TTL_MS` — longer than either
 * (an active investigation, not a single round trip), but still short and
 * bounded, per FR-SEC-010's own "every human-operator session must have an
 * explicit maximum lifetime" principle.
 */
export const SUPPORT_SESSION_LIFETIME_MS = 60 * 60 * 1000;

/**
 * TASK-SEC-006 — how long an elevation request (view raw transaction
 * detail) stays approvable. Same disclosed-default posture and duration as
 * `ADMIN_ELEVATION_REQUEST_TTL_MS` (TASK-AUTH-005) — reused here as the
 * elevation-specific window, always additionally capped at the parent
 * support session's own remaining lifetime (FR-SEC-013's nesting
 * principle: a nested credential can never outlive the one that
 * authorized it).
 */
export const SUPPORT_SESSION_ELEVATION_REQUEST_TTL_MS = 15 * 60 * 1000;
