import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ApiToken } from '@afa/domain';
import { ApiTokenInvalidError, ValidateApiTokenUseCase } from '@afa/application';
import type { Request } from 'express';

export interface AuthenticatedApiTokenRequest extends Request {
  apiToken: ApiToken;
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
 * TASK-AUTH-003 — the API-consumer analogue of AUTH-002's
 * `AdminSessionGuard` (same shape, same generic-401 discipline — a missing,
 * malformed, unknown, revoked, or expired token all reject identically, no
 * leaked distinction). `@Inject(ValidateApiTokenUseCase)` explicit — the
 * exact lesson from AUTH-002's `AdminAuthController`/`AdminSessionGuard`:
 * bare class-type constructor injection across the `@afa/application`
 * package boundary silently resolved to `undefined` under `@nestjs/testing`
 * + Vitest, only caught by a real protected-route test.
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(
    @Inject(ValidateApiTokenUseCase) private readonly validateApiToken: ValidateApiTokenUseCase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedApiTokenRequest>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Invalid or expired API token.');
    }

    try {
      request.apiToken = await this.validateApiToken.execute(token);
      return true;
    } catch (error) {
      if (error instanceof ApiTokenInvalidError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }
  }
}
