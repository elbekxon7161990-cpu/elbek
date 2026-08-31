import { Inject, Injectable } from '@nestjs/common';
import type { DraftRepository, TransactionDraftRecord } from '@afa/domain';
import { DRAFT_REPOSITORY, isDraftExpired } from '@afa/domain';

export interface ListDraftsInput {
  userId: string;
  currentDateTime: Date;
}

/**
 * TASK-BOT-004 (FR-CE-020) — "Draft transactions must be retrievable via a
 * `/drafts` command, showing any incomplete transactions awaiting
 * clarification, sorted most recent first." `DraftRepository.findActiveByUserId`
 * already scopes to the current user and `status: 'pending'`; this use case
 * adds the one thing that repository call can't do itself — FR-CE-021's
 * lazy 30-day expiry (`isDraftExpired`) — so an inactive-but-not-yet-swept
 * draft never surfaces in `/drafts` as if it were still actionable.
 */
@Injectable()
export class ListDraftsUseCase {
  constructor(@Inject(DRAFT_REPOSITORY) private readonly draftRepository: DraftRepository) {}

  async execute(input: ListDraftsInput): Promise<TransactionDraftRecord[]> {
    const drafts = await this.draftRepository.findActiveByUserId(input.userId);
    return drafts.filter(
      (draft) => !isDraftExpired(draft.lastInteractionAt, input.currentDateTime),
    );
  }
}
