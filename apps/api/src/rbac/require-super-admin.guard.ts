import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';

import type { AuthenticatedAdminRequest } from '../admin-auth/admin-session.guard';

/**
 * TASK-AUTH-005 — coarse, route-level role gate (FR-SEC-002: "every
 * authorization check resolves against the role's explicitly granted
 * scope... never a judgment call made at request time"). MUST be composed
 * AFTER `AdminSessionGuard` (`@UseGuards(AdminSessionGuard,
 * RequireSuperAdminGuard)`) — NestJS runs guards in the order listed, and
 * this guard reads `request.admin`, which only `AdminSessionGuard` sets. A
 * valid authenticated session alone is never sufficient here — this is the
 * server-side role check that makes that explicit.
 *
 * Deliberately generic "Forbidden" — never states which role was required,
 * so a caller without `super_admin` learns nothing about the authorization
 * model beyond "not permitted."
 */
@Injectable()
export class RequireSuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedAdminRequest>();
    if (request.admin?.role !== 'super_admin') {
      throw new ForbiddenException('Forbidden.');
    }
    return true;
  }
}
