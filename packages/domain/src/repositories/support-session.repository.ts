import type { SupportSession } from '../entities/support-session.entity';

export const SUPPORT_SESSION_REPOSITORY = Symbol('SUPPORT_SESSION_REPOSITORY');

export interface NewSupportSessionData {
  agentAdminId: string;
  targetUserId: string;
  justification: string;
  expiresAt: Date;
}

/**
 * TASK-SEC-006 — Chapter 11 §11.2.6/§11.7.2's support-session flow.
 */
export interface SupportSessionRepository {
  /**
   * NFR-ADM-002 — the audit_log write is synchronous with session creation,
   * inside the SAME database transaction (see
   * `PrismaSupportSessionRepository.create()`'s own doc comment): a failed
   * audit write means the session was never created either, never a
   * silent, un-audited `Active` session.
   */
  create(data: NewSupportSessionData): Promise<SupportSession>;

  /** Excludes closed, expired, and past-expiry sessions — an "active session" lookup. */
  findActiveById(id: string, now: Date): Promise<SupportSession | null>;

  /**
   * Atomically closes the session (agent-ended) if it is still open.
   * Returns `false` if already closed/expired — never throws for that case.
   */
  close(id: string, now: Date): Promise<boolean>;

  /**
   * Worker-invoked sweep (§11.7.2 "-> Expired: session timeout"): marks
   * every session past `expiresAt` and not already closed/expired.
   * Returns the number of rows transitioned.
   */
  expireDueSessions(now: Date): Promise<number>;
}
