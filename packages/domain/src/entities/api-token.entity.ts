/**
 * TASK-AUTH-003 — mirrors the `api_tokens` table's core columns (schema.prisma's
 * `ApiToken` model, itself a disclosed Engineering Execution Decision — see
 * schema.prisma's file header, same precedent as `AdminSession`). Plain
 * class, no ORM decorators — same discipline as `Admin`/`AdminSession`.
 */
export class ApiToken {
  constructor(
    public readonly id: string,
    // FR-AUTH-005 — names the issued-to consumer; never a shared static key.
    public readonly clientIdentifier: string,
    public readonly tokenType: 'access' | 'refresh',
    public readonly tokenHash: string,
    // §14.15.4 — `{resource}:{verb}` or `admin:{resource}:{verb}`, immutable
    // for the token's lifetime (FR-API-083) — never widened by a refresh.
    public readonly scope: string[],
    public readonly rateLimitPerMinute: number,
    // TASK-AUTH-003 — for an access token, the refresh token that issued it;
    // for a refresh token, the PRIOR refresh token it rotated from (null for
    // the token minted at initial issuance). See `TokenRefreshChain`'s own
    // doc comment in schema.prisma.
    public readonly parentTokenId: string | null,
    public readonly expiresAt: Date,
    public readonly revokedAt: Date | null,
    public readonly createdAt: Date,
  ) {}
}
