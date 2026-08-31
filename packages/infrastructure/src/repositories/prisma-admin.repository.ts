import { Injectable } from '@nestjs/common';
import type { AdminLockoutState, AdminRepository, NewAdminData } from '@afa/domain';
import { Admin } from '@afa/domain';
import type { Admin as PrismaAdmin } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

function toDomainAdmin(row: PrismaAdmin): Admin {
  return new Admin(
    row.id,
    row.email,
    row.passwordHash,
    row.mfaSecretRef,
    row.role as Admin['role'],
    row.status as Admin['status'],
    row.failedLoginAttempts,
    row.failedLoginWindowStartedAt,
    row.lockedUntil,
    row.lockoutCycleCount,
    row.createdAt,
    row.updatedAt,
  );
}

/**
 * TASK-AUTH-002 — `AdminRepository` adapter, same read/write shape as
 * `PrismaUserRepository`.
 */
@Injectable()
export class PrismaAdminRepository implements AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<Admin | null> {
    const row = await this.prisma.admin.findUnique({ where: { email } });
    return row ? toDomainAdmin(row) : null;
  }

  async findById(id: string): Promise<Admin | null> {
    const row = await this.prisma.admin.findUnique({ where: { id } });
    return row ? toDomainAdmin(row) : null;
  }

  async create(data: NewAdminData): Promise<Admin> {
    const row = await this.prisma.admin.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        mfaSecretRef: data.mfaSecretRef,
        role: data.role,
        status: 'active',
      },
    });
    return toDomainAdmin(row);
  }

  /**
   * Optimistic-concurrency conditional write — same shape as
   * `PrismaUserRepository.cancelDeletion`: the WHERE clause additionally
   * requires every lockout-relevant column to still equal `expected` at
   * write time, so a decision computed by `computeAdminLockoutOutcome`
   * against a state that has since changed (a second concurrent failed
   * attempt against the same admin) never gets applied — the loser's
   * `updateMany` matches zero rows, returns `null`, and the caller re-reads
   * and recomputes against the now-current state.
   */
  async applyFailedLoginOutcome(
    adminId: string,
    expected: AdminLockoutState,
    next: AdminLockoutState,
  ): Promise<Admin | null> {
    const result = await this.prisma.admin.updateMany({
      where: {
        id: adminId,
        failedLoginAttempts: expected.failedLoginAttempts,
        failedLoginWindowStartedAt: expected.failedLoginWindowStartedAt,
        lockedUntil: expected.lockedUntil,
        lockoutCycleCount: expected.lockoutCycleCount,
      },
      data: {
        failedLoginAttempts: next.failedLoginAttempts,
        failedLoginWindowStartedAt: next.failedLoginWindowStartedAt,
        lockedUntil: next.lockedUntil,
        lockoutCycleCount: next.lockoutCycleCount,
      },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(adminId);
  }

  async resetLoginFailureState(adminId: string): Promise<Admin> {
    const row = await this.prisma.admin.update({
      where: { id: adminId },
      data: {
        failedLoginAttempts: 0,
        failedLoginWindowStartedAt: null,
        lockedUntil: null,
        lockoutCycleCount: 0,
      },
    });
    return toDomainAdmin(row);
  }
}
