/**
 * TASK-AUTH-005 — mirrors the `audit_log` table (schema.prisma's `AuditLog`
 * model, §16.4.2). Immutable once written: no domain operation ever mutates
 * or deletes an existing entry, matching the DB-role-level INSERT/SELECT-only
 * restriction already enforced at the migration level (TASK-DB-005).
 */
export class AuditLogEntry {
  constructor(
    public readonly id: string,
    public readonly actorType: 'admin' | 'support_agent' | 'system' | 'api_client',
    public readonly actorId: string | null,
    public readonly action: string,
    public readonly targetUserId: string | null,
    public readonly targetResource: string | null,
    public readonly justification: string | null,
    public readonly ipAddress: string | null,
    public readonly metadata: Record<string, unknown> | null,
    public readonly createdAt: Date,
  ) {}
}
