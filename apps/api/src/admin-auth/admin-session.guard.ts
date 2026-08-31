import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Admin } from '@afa/domain';
import { ValidateAdminSessionUseCase } from '@afa/application';
import type { Request } from 'express';

import { AdminSessionInvalidError } from '@afa/application';

export interface AuthenticatedAdminRequest extends Request {
  admin: Admin;
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }
  return token;
}

/**
 * TASK-AUTH-002 — the "cannot reach any protected route without both
 * factors" enforcement point (this task's DoD). Any Authorization-header
 * problem (missing, malformed, unknown token, revoked, expired, idle
 * timed-out, deactivated admin) rejects with the same generic 401 — same
 * "must not leak which specific reason" discipline `AdminSessionInvalidError`
 * already establishes at the application layer.
 *
 * `@Inject(ValidateAdminSessionUseCase)` explicit — see
 * `AdminAuthController`'s own doc comment for why bare class-type
 * constructor injection across the `@afa/application` package boundary is
 * unsafe under this project's `@nestjs/testing` + Vitest setup.
 */
@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(
    @Inject(ValidateAdminSessionUseCase)
    private readonly validateAdminSession: ValidateAdminSessionUseCase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedAdminRequest>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    try {
      request.admin = await this.validateAdminSession.execute(token);
      return true;
    } catch (error) {
      if (error instanceof AdminSessionInvalidError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }
  }
}
