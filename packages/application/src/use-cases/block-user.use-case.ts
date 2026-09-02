import { Inject, Injectable } from '@nestjs/common';
import type { AuditLogRepository, UserRepository } from '@afa/domain';
import { AUDIT_LOG_REPOSITORY, USER_REPOSITORY } from '@afa/domain';

/**
 * `not_eligible` is returned, never thrown, when the user was not `active`
 * at the moment of the write (already `deactivated`/`pending_deletion`/
 * `deleted`, or a genuine concurrent-request race) — mirrors
 * `RequestAccountDeletionUseCase`'s own outcome shape exactly.
 */
export type BlockUserOutcome =
  { kind: 'blocked' } | { kind: 'not_eligible'; currentStatus: string };

/**
 * Admin-panel action — requires a written justification (same discipline
 * `OpenSupportSessionUseCase` already established for admin actions against
 * a specific user) and writes a standalone audit-log entry via the generic
 * `AuditLogRepository` port (`AUDIT_LOG_REPOSITORY`) after a successful
 * write — a single-table atomic conditional write, so (unlike the
 * elevation-grant flow) the audit entry does not need to be coupled inside
 * the same transaction as the status change itself.
 */
@Injectable()
export class BlockUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async execute(
    userId: string,
    justification: string,
    actorAdminId: string,
  ): Promise<BlockUserOutcome> {
    const blocked = await this.userRepository.block(userId);
    if (!blocked) {
      const current = await this.userRepository.findById(userId);
      return { kind: 'not_eligible', currentStatus: current?.status ?? 'unknown' };
    }

    await this.auditLogRepository.create({
      actorType: 'admin',
      actorId: actorAdminId,
      action: 'user.block',
      targetUserId: userId,
      targetResource: null,
      justification,
      ipAddress: null,
      metadata: null,
    });

    return { kind: 'blocked' };
  }
}
