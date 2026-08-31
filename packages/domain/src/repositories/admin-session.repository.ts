import type { AdminSession } from '../entities/admin-session.entity';

export const ADMIN_SESSION_REPOSITORY = Symbol('ADMIN_SESSION_REPOSITORY');

export interface NewAdminSessionData {
  adminId: string;
  tokenHash: string;
  ipAddress: string | null;
  expiresAt: Date;
}

/**
 * TASK-AUTH-002 — Chapter 14 §14.15.2's Bearer-session model, Chapter 16
 * §16.11's session-management policy (FR-SEC-010/011/012). Only `tokenHash`
 * is ever persisted (§14.15.2's diagram) — the raw token exists only in the
 * response body returned once at issuance and in the caller's own
 * `Authorization: Bearer <token>` header on every subsequent request.
 */
export interface AdminSessionRepository {
  create(data: NewAdminSessionData): Promise<AdminSession>;
  /** Excludes revoked and expired sessions — a "live session" lookup, not a raw row fetch. */
  findActiveByTokenHash(tokenHash: string, now: Date): Promise<AdminSession | null>;
  touchLastActive(id: string, now: Date): Promise<void>;
  revoke(id: string, now: Date): Promise<void>;
}
