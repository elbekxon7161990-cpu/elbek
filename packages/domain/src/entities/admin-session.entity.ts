/**
 * TASK-AUTH-002 — mirrors the `admin_sessions` table (schema.prisma's
 * `AdminSession` model, itself a disclosed Engineering Execution Decision —
 * see schema.prisma's file header). `tokenHash` only: the raw bearer token
 * is never persisted anywhere, only its hash (§14.15.2's Bearer-token model).
 */
export class AdminSession {
  constructor(
    public readonly id: string,
    public readonly adminId: string,
    public readonly tokenHash: string,
    public readonly parentSessionId: string | null,
    public readonly ipAddress: string | null,
    public readonly createdAt: Date,
    public readonly lastActiveAt: Date,
    // NFR-AUTH-002 — absolute expiry ceiling (<=24h), independent of activity
    public readonly expiresAt: Date,
    public readonly revokedAt: Date | null,
  ) {}
}
