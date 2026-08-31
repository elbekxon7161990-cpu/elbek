import { Injectable } from '@nestjs/common';
import type { NewUserData, UserRepository } from '@afa/domain';
import { User, accountDeletionCutoff } from '@afa/domain';
import { Prisma, type User as PrismaUser } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

function toDomainUser(row: PrismaUser): User {
  return new User(
    row.id,
    row.telegramUserId,
    row.telegramUsername,
    row.displayName,
    row.preferredLanguage,
    row.defaultCurrency,
    row.timezone,
    row.status,
    row.onboardingCompletedAt,
    row.deletionRequestedAt,
    row.createdAt,
    row.updatedAt,
  );
}

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTelegramUserId(telegramUserId: bigint): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { telegramUserId } });
    return row ? toDomainUser(row) : null;
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? toDomainUser(row) : null;
  }

  async create(data: NewUserData): Promise<User> {
    try {
      const row = await this.prisma.user.create({
        data: {
          telegramUserId: data.telegramUserId,
          telegramUsername: data.telegramUsername,
          displayName: data.displayName,
          preferredLanguage: data.preferredLanguage,
        },
      });
      return toDomainUser(row);
    } catch (error) {
      // Concurrent double-/start delivery can race two creates against the
      // same telegram_user_id unique constraint — the loser re-fetches
      // instead of surfacing a 500 to the use-case (NFR-AUTH-001).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.findByTelegramUserId(data.telegramUserId);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  async reactivate(id: string): Promise<User> {
    const row = await this.prisma.user.update({
      where: { id },
      data: { status: 'active' },
    });
    return toDomainUser(row);
  }

  async requestDeletion(userId: string, requestedAt: Date): Promise<User | null> {
    const result = await this.prisma.user.updateMany({
      where: { id: userId, status: 'active' },
      data: { status: 'pending_deletion', deletionRequestedAt: requestedAt },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(userId);
  }

  async cancelDeletion(userId: string, now: Date): Promise<User | null> {
    const result = await this.prisma.user.updateMany({
      where: {
        id: userId,
        status: 'pending_deletion',
        // Grace-period-still-open guard — see UserRepository.cancelDeletion's
        // own doc comment for why this is what makes cancellation and the
        // scheduled purge mutually exclusive with no extra locking.
        deletionRequestedAt: { gt: accountDeletionCutoff(now) },
      },
      data: { status: 'active', deletionRequestedAt: null },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(userId);
  }

  async findExpiredPendingDeletions(now: Date): Promise<User[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        status: 'pending_deletion',
        deletionRequestedAt: { lte: accountDeletionCutoff(now) },
      },
    });
    return rows.map(toDomainUser);
  }

  async updateProfile(
    userId: string,
    data: Partial<{ preferredLanguage: string; defaultCurrency: string; timezone: string }>,
  ): Promise<User> {
    const row = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.preferredLanguage !== undefined && { preferredLanguage: data.preferredLanguage }),
        ...(data.defaultCurrency !== undefined && { defaultCurrency: data.defaultCurrency }),
        ...(data.timezone !== undefined && { timezone: data.timezone }),
      },
    });
    return toDomainUser(row);
  }
}
