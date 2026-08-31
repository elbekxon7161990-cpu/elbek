import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  RequireElevatedSupportSessionUseCase,
  SupportSessionElevationInvalidError,
} from '@afa/application';

import type { AuthenticatedSupportSessionRequest } from './support-session.guard';

/**
 * TASK-SEC-006 — MUST be composed AFTER `SupportSessionGuard`
 * (`@UseGuards(AdminSessionGuard, SupportSessionGuard,
 * RequireElevatedSupportSessionGuard)`) — reads `request.supportSession`,
 * which only `SupportSessionGuard` sets. Proves the session is currently
 * `Elevated` (§11.2.6's "raw transaction detail requires an additional
 * elevated-access step"). Generic 403.
 */
@Injectable()
export class RequireElevatedSupportSessionGuard implements CanActivate {
  constructor(
    @Inject(RequireElevatedSupportSessionUseCase)
    private readonly requireElevated: RequireElevatedSupportSessionUseCase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedSupportSessionRequest>();

    try {
      await this.requireElevated.execute(request.supportSession.id);
      return true;
    } catch (error) {
      if (error instanceof SupportSessionElevationInvalidError) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }
}
