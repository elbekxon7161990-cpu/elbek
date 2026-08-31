/**
 * TASK-AUTH-005 — how long an `admin` -> `super_admin` elevation request
 * stays approvable before it goes stale. Not PRD-specified; a disclosed
 * judgment call, same posture as TASK-AUTH-002's `ADMIN_MFA_CHALLENGE_TTL_MS`
 * — a short window for a two-human real-time coordination step (the
 * requester and a second, existing `super_admin` approver), not a product
 * policy value requiring its own PRD requirement.
 */
export const ADMIN_ELEVATION_REQUEST_TTL_MS = 15 * 60 * 1000;
