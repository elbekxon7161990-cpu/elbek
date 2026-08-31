import { Inject, Injectable } from '@nestjs/common';
import type { UserRepository } from '@afa/domain';
import { USER_REPOSITORY } from '@afa/domain';

/**
 * TASK-AUTH-006 (FR-RET-001 — "recoverable if the user reverses the
 * request"). The exact inverse of `RequestAccountDeletionUseCase`
 * (`pending_deletion` → `active`, `deletionRequestedAt` cleared). Wired to
 * the "Cancel account deletion" inline button (`apps/telegram-bot`'s
 * `delacct_cancel_pending` callback) — a distinct concept from `/cancel`'s
 * own conversation-cancellation semantics, and from `delacct_cancel`
 * (declining the initial "type DELETE" prompt, before any deletion was
 * ever requested).
 *
 * `grace_period_expired` is reported distinctly from `not_pending`: both
 * are `UserRepository.cancelDeletion`'s atomic write failing, but they mean
 * different things to the user — "your account is not currently pending
 * deletion at all" vs. "it was, but the 30-day window has already closed
 * and this can no longer be reversed."
 */
export type CancelAccountDeletionOutcome =
  | { kind: 'cancelled' }
  | { kind: 'grace_period_expired' }
  | { kind: 'not_pending'; currentStatus: string };

@Injectable()
export class CancelAccountDeletionUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly userRepository: UserRepository) {}

  async execute(userId: string, now: Date = new Date()): Promise<CancelAccountDeletionOutcome> {
    const updated = await this.userRepository.cancelDeletion(userId, now);
    if (updated) {
      return { kind: 'cancelled' };
    }
    const current = await this.userRepository.findById(userId);
    if (current?.status === 'pending_deletion') {
      // The only way `cancelDeletion`'s atomic write can fail while the
      // user is STILL `pending_deletion` is its own grace-period-still-open
      // clause not matching — i.e. the 30-day window has already closed.
      return { kind: 'grace_period_expired' };
    }
    return { kind: 'not_pending', currentStatus: current?.status ?? 'unknown' };
  }
}
