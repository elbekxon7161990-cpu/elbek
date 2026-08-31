import { Inject, Injectable } from '@nestjs/common';
import type { SupportSessionElevationRepository } from '@afa/domain';
import { SUPPORT_SESSION_ELEVATION_REPOSITORY } from '@afa/domain';

import { SupportSessionElevationInvalidError } from '../errors/support-session-elevation-invalid.error';

/**
 * TASK-SEC-006 — the per-request check behind `RequireElevatedSupportSessionGuard`.
 * Composed AFTER `SupportSessionGuard` (which already proved the caller owns
 * an active session) — this proves that session is CURRENTLY `Elevated`,
 * per §11.2.6's "raw transaction detail requires an additional
 * elevated-access step."
 */
@Injectable()
export class RequireElevatedSupportSessionUseCase {
  constructor(
    @Inject(SUPPORT_SESSION_ELEVATION_REPOSITORY)
    private readonly elevations: SupportSessionElevationRepository,
  ) {}

  async execute(supportSessionId: string): Promise<void> {
    const current = await this.elevations.findCurrentlyElevated(supportSessionId, new Date());
    if (!current) {
      throw new SupportSessionElevationInvalidError();
    }
  }
}
