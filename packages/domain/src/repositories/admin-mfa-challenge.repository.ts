export const ADMIN_MFA_CHALLENGE_REPOSITORY = Symbol('ADMIN_MFA_CHALLENGE_REPOSITORY');

export interface AdminMfaChallenge {
  adminId: string;
  createdAt: Date;
}

/**
 * TASK-AUTH-002 — the short-lived server-side link between the password
 * step and the MFA step of §7.7.5's two-step admin login (a challenge token
 * proves "this caller already presented a correct password for this admin",
 * without which the MFA-verification step would only need to guess an
 * email address to attempt TOTP codes against — both factors must actually
 * be required, not merely both eventually checked). Deliberately NOT the
 * `AdminSession`/Bearer-session model: a challenge never authorizes access
 * to any protected route, and is consumed (deleted) on first successful use
 * or on expiry, whichever comes first — the same single-use/short-lived
 * shape FR-AUTH-012 already establishes for this codebase's other
 * one-time-code mechanism (account-linking/support verification), reused
 * here rather than inventing a second one-time-token primitive.
 */
export interface AdminMfaChallengeRepository {
  create(adminId: string, ttlMs: number): Promise<string>;
  /** Does not delete on read — a wrong TOTP code may be retried within the same short TTL, still counted toward NFR-AUTH-004's lockout threshold. */
  get(challengeToken: string): Promise<AdminMfaChallenge | null>;
  consume(challengeToken: string): Promise<void>;
}
