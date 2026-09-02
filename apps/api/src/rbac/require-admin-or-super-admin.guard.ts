import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';

import type { AuthenticatedAdminRequest } from '../admin-auth/admin-session.guard';

/**
 * Web admin panel — same shape as `RequireSuperAdminGuard`, gating a
 * moderately sensitive action (block/unblock a user) to `admin`+`super_admin`,
 * excluding `support_agent`. MUST be composed AFTER `AdminSessionGuard`
 * (`@UseGuards(AdminSessionGuard, RequireAdminOrSuperAdminGuard)`) — reads
 * `request.admin`, which only `AdminSessionGuard` sets. Deliberately generic
 * "Forbidden" — never states which role was required, same reasoning as
 * `RequireSuperAdminGuard`.
 */
@Injectable()
export class RequireAdminOrSuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedAdminRequest>();
    if (request.admin?.role !== 'admin' && request.admin?.role !== 'super_admin') {
      throw new ForbiddenException('Forbidden.');
    }
    return true;
  }
}
