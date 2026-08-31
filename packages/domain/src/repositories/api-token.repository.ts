import type { ApiToken } from '../entities/api-token.entity';

export const API_TOKEN_REPOSITORY = Symbol('API_TOKEN_REPOSITORY');

export interface NewApiTokenData {
  clientIdentifier: string;
  tokenType: 'access' | 'refresh';
  tokenHash: string;
  scope: string[];
  rateLimitPerMinute: number;
  parentTokenId: string | null;
  expiresAt: Date;
}

/**
 * Port (Chapter 3 §3.3.9 hexagonal boundary) — implemented by
 * packages/infrastructure, consumed by @afa/application use-cases via
 * API_TOKEN_REPOSITORY.
 */
export interface ApiTokenRepository {
  create(data: NewApiTokenData): Promise<ApiToken>;
  findById(id: string): Promise<ApiToken | null>;
  /**
   * Excludes revoked and expired rows — a "live token" lookup, not a raw
   * row fetch (same discipline as `AdminSessionRepository.findActiveByTokenHash`).
   * `tokenType`, when given, additionally restricts the match — an access
   * token must never authenticate at the refresh endpoint and a refresh
   * token must never authenticate an ordinary protected route.
   */
  findActiveByTokenHash(
    tokenHash: string,
    now: Date,
    tokenType?: 'access' | 'refresh',
  ): Promise<ApiToken | null>;
  /**
   * TASK-AUTH-003 (rotation) — atomic conditional revoke: `revokedAt` is set
   * only if the row is still `revokedAt IS NULL` at write time. Returns
   * `true` only for the caller that actually performed the revoke (won the
   * race); `false` means the row was already revoked — by a genuine replay
   * of an already-used refresh token, or by a concurrent request that won
   * first. Either way the caller must treat `false` as "reject", never
   * retry or reinterpret it — this IS the "first successful rotation wins"
   * rule, enforced as a single atomic UPDATE ... WHERE, the same
   * optimistic-concurrency shape `PrismaAdminRepository.applyFailedLoginOutcome`
   * already established for this codebase's other race-sensitive state
   * transitions.
   */
  consumeRefreshToken(id: string, now: Date): Promise<boolean>;
  /** Admin-triggered, deliberate, idempotent (already-revoked is a safe no-op, not an error). */
  revoke(id: string, now: Date): Promise<void>;
}
