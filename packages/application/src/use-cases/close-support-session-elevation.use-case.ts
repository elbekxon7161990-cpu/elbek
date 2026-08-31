import { Inject, Injectable } from '@nestjs/common';
import type { SupportSessionElevationRepository } from '@afa/domain';
import { SUPPORT_SESSION_ELEVATION_REPOSITORY } from '@afa/domain';

import { SupportSessionElevationInvalidError } from '../errors/support-session-elevation-invalid.error';
import { ValidateSupportSessionUseCase } from './validate-support-session.use-case';

export interface CloseSupportSessionElevationInput {
  sessionId: string;
  elevationRequestId: string;
  callerAdminId: string;
}

/** TASK-SEC-006 — §11.7.2 "Elevated -> Active: elevated view closed." Agent-initiated, on their own session. */
@Injectable()
export class CloseSupportSessionElevationUseCase {
  constructor(
    @Inject(SUPPORT_SESSION_ELEVATION_REPOSITORY)
    private readonly elevations: SupportSessionElevationRepository,
    @Inject(ValidateSupportSessionUseCase)
    private readonly validateSupportSession: ValidateSupportSessionUseCase,
  ) {}

  async execute(input: CloseSupportSessionElevationInput): Promise<void> {
    const session = await this.validateSupportSession.execute(input);

    const current = await this.elevations.findCurrentlyElevated(session.id, new Date());
    if (!current || current.id !== input.elevationRequestId) {
      throw new SupportSessionElevationInvalidError();
    }

    const closed = await this.elevations.close(current.id, new Date());
    if (!closed) {
      throw new SupportSessionElevationInvalidError();
    }
  }
}
