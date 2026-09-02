import { Inject, Injectable } from '@nestjs/common';
import type { SupportSession, SupportSessionRepository } from '@afa/domain';
import { SUPPORT_SESSION_REPOSITORY } from '@afa/domain';

/**
 * Admin-panel support-session list — every session the calling admin
 * currently has open, mirroring `SupportSessionGuard`'s own per-agent
 * ownership boundary (see `SupportSessionRepository.findActiveByAgentAdminId`'s
 * own doc comment for why this is scoped to one agent, not every admin's
 * sessions).
 */
@Injectable()
export class ListMySupportSessionsUseCase {
  constructor(
    @Inject(SUPPORT_SESSION_REPOSITORY)
    private readonly supportSessionRepository: SupportSessionRepository,
  ) {}

  async execute(agentAdminId: string, now: Date = new Date()): Promise<readonly SupportSession[]> {
    return this.supportSessionRepository.findActiveByAgentAdminId(agentAdminId, now);
  }
}
