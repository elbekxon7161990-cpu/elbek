/**
 * TASK-SEC-006 — mirrors `support_session_elevation_requests`. Pending while
 * `resolvedAt` is null. "Currently elevated" = `resolvedAt` set AND
 * `closedAt` still null AND not past its own `expiresAt`.
 */
export class SupportSessionElevationRequest {
  constructor(
    public readonly id: string,
    public readonly supportSessionId: string,
    public readonly createdAt: Date,
    public readonly expiresAt: Date,
    public readonly resolvedAt: Date | null,
    public readonly resolvedByAdminId: string | null,
    public readonly closedAt: Date | null,
  ) {}
}
