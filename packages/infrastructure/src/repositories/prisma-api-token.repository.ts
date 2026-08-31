import { Injectable } from '@nestjs/common';
import type { ApiTokenRepository, NewApiTokenData } from '@afa/domain';
import { ApiToken } from '@afa/domain';
import type { ApiToken as PrismaApiToken } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

function toDomainApiToken(row: PrismaApiToken): ApiToken {
  return new ApiToken(
    row.id,
    row.clientIdentifier,
    row.tokenType as ApiToken['tokenType'],
    row.tokenHash,
    row.scope,
    row.rateLimitPerMinute,
    row.parentTokenId,
    row.expiresAt,
    row.revokedAt,
    row.createdAt,
  );
}

/** TASK-AUTH-003 — `ApiTokenRepository` adapter, same read/write shape as `PrismaAdminSessionRepository`. */
@Injectable()
export class PrismaApiTokenRepository implements ApiTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewApiTokenData): Promise<ApiToken> {
    const row = await this.prisma.apiToken.create({
      data: {
        clientIdentifier: data.clientIdentifier,
        tokenType: data.tokenType,
        tokenHash: data.tokenHash,
        scope: data.scope,
        rateLimitPerMinute: data.rateLimitPerMinute,
        parentTokenId: data.parentTokenId,
        expiresAt: data.expiresAt,
      },
    });
    return toDomainApiToken(row);
  }

  async findById(id: string): Promise<ApiToken | null> {
    const row = await this.prisma.apiToken.findUnique({ where: { id } });
    return row ? toDomainApiToken(row) : null;
  }

  async findActiveByTokenHash(
    tokenHash: string,
    now: Date,
    tokenType?: 'access' | 'refresh',
  ): Promise<ApiToken | null> {
    const row = await this.prisma.apiToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
        ...(tokenType ? { tokenType } : {}),
      },
    });
    return row ? toDomainApiToken(row) : null;
  }

  /**
   * Single atomic `UPDATE ... WHERE id = ? AND revoked_at IS NULL` — the
   * database itself is what decides which of two concurrent callers "wins"
   * (Postgres serializes concurrent updates to the same row), never a
   * client-side read-then-write race. See this port's own doc comment for
   * why `false` must always mean "reject", not "retry".
   */
  async consumeRefreshToken(id: string, now: Date): Promise<boolean> {
    const result = await this.prisma.apiToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now },
    });
    return result.count > 0;
  }

  async revoke(id: string, now: Date): Promise<void> {
    await this.prisma.apiToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now },
    });
  }
}
