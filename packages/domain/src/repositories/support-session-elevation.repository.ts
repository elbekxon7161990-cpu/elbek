import type { SupportSessionElevationRequest } from '../entities/support-session-elevation-request.entity';

export const SUPPORT_SESSION_ELEVATION_REPOSITORY = Symbol('SUPPORT_SESSION_ELEVATION_REPOSITORY');

export interface NewSupportSessionElevationRequestData {
  supportSessionId: string;
  expiresAt: Date;
}

export interface GrantSupportSessionElevationParams {
  requestId: string;
  /** Immutable on the request row — safe to pass forward from the caller's earlier read. */
  supportSessionId: string;
  targetUserId: string;
  approverAdminId: string;
  now: Date;
}

/**
 * TASK-SEC-006 — Chapter 11 §11.7.2's `Active` -> `Elevated` approval flow.
 * Deliberately separate from `AdminElevationRepository` (TASK-AUTH-005) —
 * see schema.prisma's own doc comment for why (permanent role mutation vs.
 * temporary, session-scoped, reversible state).
 */
export interface SupportSessionElevationRepository {
  createRequest(
    data: NewSupportSessionElevationRequestData,
  ): Promise<SupportSessionElevationRequest>;

  /** Excludes resolved and expired requests — a "pending request" lookup. */
  findPendingById(id: string, now: Date): Promise<SupportSessionElevationRequest | null>;

  /**
   * Atomically consumes the request and, in the SAME transaction, writes
   * the `audit_log` entry — same shape as
   * `AdminElevationRepository.grant()` (TASK-AUTH-005): a failed audit
   * write rolls back the consume too, never a silent partial grant.
   * Returns `false` (never throws) when the conditional consume itself
   * finds nothing pending — the same race-loss semantics established
   * throughout this codebase.
   */
  grant(params: GrantSupportSessionElevationParams): Promise<boolean>;

  /** The currently-active elevation grant for a session, if any (resolved, not closed, not expired). */
  findCurrentlyElevated(
    supportSessionId: string,
    now: Date,
  ): Promise<SupportSessionElevationRequest | null>;

  /** Agent-initiated de-elevation (§11.7.2 "Elevated -> Active"). Atomic; `false` if already closed. */
  close(id: string, now: Date): Promise<boolean>;
}
