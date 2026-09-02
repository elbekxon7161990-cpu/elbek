import { Inject, Injectable } from '@nestjs/common';
import type { AuditLogRepository, UserRepository } from '@afa/domain';
import { AUDIT_LOG_REPOSITORY, USER_REPOSITORY } from '@afa/domain';

export type UnblockUserOutcome =
  { kind: 'unblocked' } | { kind: 'not_eligible'; currentStatus: string };

/**
 * Reuses `UserRepository.reactivate()` unchanged — the same
 * `'deactivated'` → `'active'` transition `ProvisionTelegramUserUseCase`
 * already uses for a user's own self-service reactivation (BR-AUTH-002,
 * "blocked-then-unblocked user, history preserved"). `reactivate()` itself
 * is NOT an atomic-conditional write (unlike `block()`/`requestDeletion()`)
 * — it unconditionally sets `status: 'active'` and throws if the row
 * doesn't exist at all — so this use case checks the current status itself
 * first, the exact same caller-checks-first pattern
 * `ProvisionTelegramUserUseCase` already established for this same method.
 */
@Injectable()
export class UnblockUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async execute(userId: string, actorAdminId: string): Promise<UnblockUserOutcome> {
    const current = await this.userRepository.findById(userId);
    if (!current || current.status !== 'deactivated') {
      return { kind: 'not_eligible', currentStatus: current?.status ?? 'unknown' };
    }

    await this.userRepository.reactivate(userId);

    await this.auditLogRepository.create({
      actorType: 'admin',
      actorId: actorAdminId,
      action: 'user.unblock',
      targetUserId: userId,
      targetResource: null,
      justification: null,
      ipAddress: null,
      metadata: null,
    });

    return { kind: 'unblocked' };
  }
}
