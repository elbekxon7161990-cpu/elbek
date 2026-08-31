import { Injectable } from '@nestjs/common';
import type { AdminSessionRepository, NewAdminSessionData } from '@afa/domain';
import { AdminSession } from '@afa/domain';
import type { AdminSession as PrismaAdminSession } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

function toDomainAdminSession(row: PrismaAdminSession): AdminSession {
  return new AdminSession(
    row.id,
    row.adminId,
    row.tokenHash,
    row.parentSessionId,
    row.ipAddress,
    row.createdAt,
    row.lastActiveAt,
    row.expiresAt,
    row.revokedAt,
  );
}

/** TASK-AUTH-002 — `AdminSessionRepository` adapter (Chapter 14 §14.15.2's Bearer-session model). */
@Injectable()
export class PrismaAdminSessionRepository implements AdminSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewAdminSessionData): Promise<AdminSession> {
    const row = await this.prisma.adminSession.create({
      data: {
        adminId: data.adminId,
        tokenHash: data.tokenHash,
        ipAddress: data.ipAddress,
        expiresAt: data.expiresAt,
      },
    });
    return toDomainAdminSession(row);
  }

  async findActiveByTokenHash(tokenHash: string, now: Date): Promise<AdminSession | null> {
    const row = await this.prisma.adminSession.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
    });
    return row ? toDomainAdminSession(row) : null;
  }

  async touchLastActive(id: string, now: Date): Promise<void> {
    await this.prisma.adminSession.update({ where: { id }, data: { lastActiveAt: now } });
  }

  async revoke(id: string, now: Date): Promise<void> {
    await this.prisma.adminSession.update({ where: { id }, data: { revokedAt: now } });
  }
}
