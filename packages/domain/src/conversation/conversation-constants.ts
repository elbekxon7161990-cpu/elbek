/** NFR-CE-003 — "Maximum clarification round-trips before fallback to manual mini-form: 2". */
export const NFR_CE_003_MAX_CLARIFICATION_RETRIES = 2;

/** §5.15.2 — "AWAITING_CLARIFICATION / AWAITING_EDIT_VALUE conversation state: 30 minutes of inactivity" (admin-configurable per §5.15.3, this is the documented default). */
export const DEFAULT_PENDING_STATE_TTL_SECONDS = 30 * 60;
