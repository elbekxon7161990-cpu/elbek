import { Module } from '@nestjs/common';

import { ApproveSupportSessionElevationUseCase } from '../use-cases/approve-support-session-elevation.use-case';
import { CloseSupportSessionElevationUseCase } from '../use-cases/close-support-session-elevation.use-case';
import { CloseSupportSessionUseCase } from '../use-cases/close-support-session.use-case';
import { ListMySupportSessionsUseCase } from '../use-cases/list-my-support-sessions.use-case';
import { OpenSupportSessionUseCase } from '../use-cases/open-support-session.use-case';
import { RequestSupportSessionElevationUseCase } from '../use-cases/request-support-session-elevation.use-case';
import { RequireElevatedSupportSessionUseCase } from '../use-cases/require-elevated-support-session.use-case';
import { ValidateSupportSessionUseCase } from '../use-cases/validate-support-session.use-case';

/**
 * TASK-SEC-006 — every support-session use case apps/api's support-sessions
 * controller/guards need. `ListMySupportSessionsUseCase` (web admin panel)
 * added here rather than a new module — it's the same feature area, same
 * `SupportSessionRepository` dependency.
 */
@Module({
  providers: [
    OpenSupportSessionUseCase,
    ValidateSupportSessionUseCase,
    CloseSupportSessionUseCase,
    RequestSupportSessionElevationUseCase,
    ApproveSupportSessionElevationUseCase,
    CloseSupportSessionElevationUseCase,
    RequireElevatedSupportSessionUseCase,
    ListMySupportSessionsUseCase,
  ],
  exports: [
    OpenSupportSessionUseCase,
    ValidateSupportSessionUseCase,
    CloseSupportSessionUseCase,
    RequestSupportSessionElevationUseCase,
    ApproveSupportSessionElevationUseCase,
    CloseSupportSessionElevationUseCase,
    RequireElevatedSupportSessionUseCase,
    ListMySupportSessionsUseCase,
  ],
})
export class SupportSessionModule {}
