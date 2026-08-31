import { Module } from '@nestjs/common';

import { ApproveSupportSessionElevationUseCase } from '../use-cases/approve-support-session-elevation.use-case';
import { CloseSupportSessionElevationUseCase } from '../use-cases/close-support-session-elevation.use-case';
import { CloseSupportSessionUseCase } from '../use-cases/close-support-session.use-case';
import { OpenSupportSessionUseCase } from '../use-cases/open-support-session.use-case';
import { RequestSupportSessionElevationUseCase } from '../use-cases/request-support-session-elevation.use-case';
import { RequireElevatedSupportSessionUseCase } from '../use-cases/require-elevated-support-session.use-case';
import { ValidateSupportSessionUseCase } from '../use-cases/validate-support-session.use-case';

/** TASK-SEC-006 — every support-session use case apps/api's support-sessions controller/guards need. */
@Module({
  providers: [
    OpenSupportSessionUseCase,
    ValidateSupportSessionUseCase,
    CloseSupportSessionUseCase,
    RequestSupportSessionElevationUseCase,
    ApproveSupportSessionElevationUseCase,
    CloseSupportSessionElevationUseCase,
    RequireElevatedSupportSessionUseCase,
  ],
  exports: [
    OpenSupportSessionUseCase,
    ValidateSupportSessionUseCase,
    CloseSupportSessionUseCase,
    RequestSupportSessionElevationUseCase,
    ApproveSupportSessionElevationUseCase,
    CloseSupportSessionElevationUseCase,
    RequireElevatedSupportSessionUseCase,
  ],
})
export class SupportSessionModule {}
