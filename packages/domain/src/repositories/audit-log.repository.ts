import type { AuditLogEntry } from '../entities/audit-log-entry.entity';

export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY');

export interface NewAuditLogEntryData {
  actorType: 'admin' | 'support_agent' | 'system' | 'api_client';
  actorId: string | null;
  action: string;
  targetUserId: string | null;
  targetResource: string | null;
  justification: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * TASK-AUTH-005 — the generic, reusable audit-log write path (§16.4.2), the
 * first of its kind in this codebase (`audit_log` previously had exactly one
 * hard-coded, non-reusable writer: `PrismaAccountPurgeRepository`, TASK-AUTH-006,
 * left untouched).
 *
 * This port is for STANDALONE writes only. Where an audit-log write must be
 * transactionally coupled to another write (this task's own elevation grant,
 * per FR-SEC-001/BR-SEC-001 — "a failed audit write means a failed
 * elevation, never a silent pass"), the coupling happens INSIDE the owning
 * repository's own atomic operation (see `AdminElevationRepository.grant()`),
 * using the same Prisma transaction client for both writes — a use case
 * calling this port and a separate use case's write can never be atomically
 * coupled across two independent repository calls, so this port is
 * deliberately not the mechanism the elevation flow's own audit write goes
 * through.
 */
export interface AuditLogRepository {
  create(data: NewAuditLogEntryData): Promise<AuditLogEntry>;
}
