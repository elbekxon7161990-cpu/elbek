/**
 * TASK-AUTH-005 — mirrors the `admin_elevation_requests` table. Pending
 * while `resolvedAt` is null; resolved (granted) once both `resolvedAt` and
 * `resolvedByAdminId` are set, atomically, by `AdminElevationRepository.grant()`.
 */
export class AdminElevationRequest {
  constructor(
    public readonly id: string,
    public readonly targetAdminId: string,
    public readonly createdAt: Date,
    public readonly expiresAt: Date,
    public readonly resolvedAt: Date | null,
    public readonly resolvedByAdminId: string | null,
  ) {}
}
