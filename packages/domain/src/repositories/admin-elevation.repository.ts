import type { AdminElevationRequest } from '../entities/admin-elevation-request.entity';

export const ADMIN_ELEVATION_REPOSITORY = Symbol('ADMIN_ELEVATION_REPOSITORY');

export interface NewAdminElevationRequestData {
  targetAdminId: string;
  expiresAt: Date;
}

export interface GrantAdminElevationParams {
  requestId: string;
  /**
   * The request's own `targetAdminId`, as read by the caller's earlier
   * `findPendingById` — safe to pass forward rather than re-read inside the
   * transaction, since a request row's `targetAdminId` is immutable from
   * creation (never updated by any code path).
   */
  targetAdminId: string;
  approverAdminId: string;
  ipAddress: string | null;
  now: Date;
}

/**
 * TASK-AUTH-005 — Chapter 16 §16.10's `admin` -> `super_admin` elevation-approval
 * architecture (FR-SEC-001-005, BR-SEC-001, AC-SEC-001).
 */
export interface AdminElevationRepository {
  createRequest(data: NewAdminElevationRequestData): Promise<AdminElevationRequest>;

  /** Excludes resolved and expired requests — a "pending request" lookup, not a raw row fetch. */
  findPendingById(id: string, now: Date): Promise<AdminElevationRequest | null>;

  /**
   * Atomically: (1) conditionally consumes the request (only if still
   * pending and unexpired — the SAME check `findPendingById` makes, but
   * re-verified here as the true concurrency-safety boundary, since a
   * caller's earlier `findPendingById` read can always have gone stale by
   * the time `grant` runs), (2) sets the target admin's `role` to
   * `'super_admin'`, (3) inserts the `audit_log` entry — all three in ONE
   * database transaction. If the audit-log INSERT fails, every part of this
   * rolls back, including the request-consume — the DoD's own "a failed
   * audit write means a failed elevation, never a silent pass," extended
   * here to "and never a silently burned approval attempt either."
   *
   * Returns `false` — never throws — when the conditional consume itself
   * finds nothing to consume (already resolved, expired, or unknown by the
   * time this runs: the same race-loss semantics `ApiTokenRepository`'s own
   * `consumeRefreshToken` already establishes in this codebase). Throws only
   * for a genuine, unexpected failure (e.g. the audit-log INSERT itself
   * erroring) — the caller must never interpret `false` as retryable.
   */
  grant(params: GrantAdminElevationParams): Promise<boolean>;
}
