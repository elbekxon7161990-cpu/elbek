/**
 * TASK-AUTH-002 — mirrors the `admins` table's core columns (Chapter 13
 * §13.9, Chapter 16 §16.4.2, packages/infrastructure/prisma/schema.prisma's
 * `Admin` model). Plain class, no ORM decorators — same discipline as
 * `User` — packages/infrastructure maps Prisma rows to/from this shape;
 * nothing in @afa/domain or @afa/application ever imports @prisma/client.
 */
export class Admin {
  constructor(
    public readonly id: string,
    // BR-AUTH-003 — individually attributable, no shared/generic admin logins
    public readonly email: string,
    public readonly passwordHash: string,
    // FR-AUTH-008 — a reference into the secret store (SECRET_STORE port),
    // never the raw TOTP seed itself. Null only before MFA enrollment
    // completes — this codebase never issues a session without MFA, so a
    // null value here means the admin cannot yet complete login, not that
    // MFA is optional.
    public readonly mfaSecretRef: string | null,
    public readonly role: 'support_agent' | 'admin' | 'super_admin',
    public readonly status: 'active' | 'deactivated',
    public readonly failedLoginAttempts: number,
    public readonly failedLoginWindowStartedAt: Date | null,
    public readonly lockedUntil: Date | null,
    public readonly lockoutCycleCount: number,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
