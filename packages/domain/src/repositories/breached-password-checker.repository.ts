export const BREACHED_PASSWORD_CHECKER = Symbol('BREACHED_PASSWORD_CHECKER');

/**
 * TASK-AUTH-002 (§7.1.8 — "not on breached-password blocklist"). The PRD
 * requires the check but never specifies the mechanism (audited: no mention
 * of a specific provider/dataset anywhere in the PRD or deployment config).
 * This port exists so a real provider can be configured later without
 * touching any call site — see packages/infrastructure's own binding for
 * which implementation is active today and why.
 */
export interface BreachedPasswordCheckerPort {
  /** Resolves `true` only when the password is confirmed breached — never throws on an inconclusive check. */
  isBreached(plaintextPassword: string): Promise<boolean>;
}
