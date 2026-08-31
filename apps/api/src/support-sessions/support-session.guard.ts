import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { SupportSession } from '@afa/domain';
import { SupportSessionInvalidError, ValidateSupportSessionUseCase } from '@afa/application';
import type { Request } from 'express';

import type { AuthenticatedAdminRequest } from '../admin-auth/admin-session.guard';

export interface AuthenticatedSupportSessionRequest extends AuthenticatedAdminRequest {
  supportSession: SupportSession;
}

/**
 * TASK-SEC-006 — MUST be composed AFTER `AdminSessionGuard`
 * (`@UseGuards(AdminSessionGuard, SupportSessionGuard)`) — reads
 * `request.admin`, which only `AdminSessionGuard` sets. Resolves the
 * `:id` route param as a support session, requiring it be both currently
 * active AND owned by the authenticated caller — cross-identity isolation
 * enforced here, not left to the use-case's callers to remember. Generic
 * 403 "Forbidden" — never distinguishes unknown/expired/closed/foreign
 * session.
 */
@Injectable()
export class SupportSessionGuard implements CanActivate {
  constructor(
    @Inject(ValidateSupportSessionUseCase)
    private readonly validateSupportSession: ValidateSupportSessionUseCase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedAdminRequest & Request & { params: { id: string } }>();

    try {
      const session = await this.validateSupportSession.execute({
        sessionId: request.params.id,
        callerAdminId: request.admin.id,
      });
      (request as unknown as AuthenticatedSupportSessionRequest).supportSession = session;
      return true;
    } catch (error) {
      if (error instanceof SupportSessionInvalidError) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }
}
