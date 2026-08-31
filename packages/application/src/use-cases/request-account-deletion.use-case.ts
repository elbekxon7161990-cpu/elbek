import { Inject, Injectable } from '@nestjs/common';
import type { UserRepository } from '@afa/domain';
import { USER_REPOSITORY } from '@afa/domain';

/**
 * TASK-AUTH-006 (Chapter 12 §12.18, FR-RET-001) — marks the account for
 * deletion after the "type DELETE" confirmation step, starting the 30-day
 * grace period. Deliberately narrow: this use case performs exactly the one
 * state transition FR-RET-001 requires (`active` → `pending_deletion`,
 * `deletionRequestedAt` set) and nothing else — no purge scheduling, no
 * financial-data soft-delete, no Object Storage cleanup. Those are the
 * scheduled purge job's own job, deliberately NOT built by this task
 * pending unresolved product decisions (see this task's own final report).
 *
 * `not_eligible` is returned, never thrown, when the user was not `active`
 * at the moment of the write (already `pending_deletion`/`deleted`/
 * `deactivated`, or a genuine concurrent-request race) — this use case does
 * not decide what that state means or what the caller should do about it,
 * only reports it honestly via `currentStatus`.
 */
export type RequestAccountDeletionOutcome =
  { kind: 'requested' } | { kind: 'not_eligible'; currentStatus: string };

@Injectable()
export class RequestAccountDeletionUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly userRepository: UserRepository) {}

  async execute(userId: string, now: Date = new Date()): Promise<RequestAccountDeletionOutcome> {
    const updated = await this.userRepository.requestDeletion(userId, now);
    if (updated) {
      return { kind: 'requested' };
    }
    const current = await this.userRepository.findById(userId);
    return { kind: 'not_eligible', currentStatus: current?.status ?? 'unknown' };
  }
}
