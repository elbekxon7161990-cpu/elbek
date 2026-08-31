/** TASK-AUTH-002 — the short-lived link between the password step and the MFA step of the two-step login (§7.7.5). Not PRD-specified; a judgment call kept short since it exists purely for one round trip. */
export const ADMIN_MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** NFR-AUTH-002 — "Admin session token expiry: <=12 hours idle, <=24 hours absolute, forced re-auth after." */
export const ADMIN_SESSION_ABSOLUTE_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const ADMIN_SESSION_IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
