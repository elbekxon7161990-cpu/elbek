/**
 * TASK-AUTH-003 — explicit policy decisions authorized by the user (not
 * invented here):
 *   - Access token lifetime: set equal to NFR-AUTH-002's admin-session
 *     absolute cap (24h), per the PRD's own text at Chapter 7 §7.7.4's
 *     Refresh row: "A short-lived access token (matching NFR-AUTH-002's
 *     session-expiry posture)". A distinct constant from
 *     `ADMIN_SESSION_ABSOLUTE_LIFETIME_MS` deliberately — same value, two
 *     independently-named concepts (an admin's own session vs. an API
 *     consumer's access token), not a shared/coupled constant.
 *   - Refresh token lifetime: 30 days exactly (FR-AUTH-009 says only
 *     "longer-lived", no PRD-given number — this is the user's explicit
 *     decision for TASK-AUTH-003).
 *   - Default per-token rate limit: 60 requests/minute (the user's explicit
 *     decision) — stored on `ApiToken.rateLimitPerMinute` only; Gateway-side
 *     enforcement of this value is Chapter 14 §14.10's own separate task,
 *     deliberately not built here (scope boundary, not an oversight).
 */
export const API_TOKEN_ACCESS_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const API_TOKEN_REFRESH_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const API_TOKEN_DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
