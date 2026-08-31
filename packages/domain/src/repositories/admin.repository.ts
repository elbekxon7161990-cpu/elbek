import type { Admin } from '../entities/admin.entity';
import type { AdminLockoutState } from '../auth/compute-admin-lockout-outcome';

/**
 * TASK-AUTH-002 — DI token, same Symbol-token pattern as USER_REPOSITORY.
 */
export const ADMIN_REPOSITORY = Symbol('ADMIN_REPOSITORY');

export interface NewAdminData {
  email: string;
  passwordHash: string;
  mfaSecretRef: string;
  role: 'support_agent' | 'admin' | 'super_admin';
}

/**
 * Port (Chapter 3 §3.3.9 hexagonal boundary) — implemented by
 * packages/infrastructure, consumed by @afa/application use-cases via
 * ADMIN_REPOSITORY. BR-AUTH-003: email is the unique, individually
 * attributable identity key — this port never supports a shared/generic
 * lookup by role alone.
 */
export interface AdminRepository {
  findByEmail(email: string): Promise<Admin | null>;
  findById(id: string): Promise<Admin | null>;
  /** Bootstrap-only (TASK-AUTH-002 Decision 4) — no self-service signup path exists. */
  create(data: NewAdminData): Promise<Admin>;

  /**
   * Atomic conditional write applying `next` (as computed by
   * `computeAdminLockoutOutcome`) only if the row's lockout-relevant columns
   * still match `expected` at write time — the same optimistic-concurrency
   * shape `PrismaUserRepository.cancelDeletion` already established for this
   * codebase's other state-machine transitions. Returns `null` (never
   * throws) when the row changed concurrently between read and write; the
   * caller re-reads and retries, exactly as a lost race should be handled —
   * never silently applying a decision computed against state that's no
   * longer current, which is what a naive read-then-write would risk under
   * concurrent failed-login attempts against the same admin.
   */
  applyFailedLoginOutcome(
    adminId: string,
    expected: AdminLockoutState,
    next: AdminLockoutState,
  ): Promise<Admin | null>;

  /**
   * Unconditional reset on a fully successful (password + MFA) login —
   * explicit instruction: a complete successful authentication always wins,
   * no optimistic-concurrency guard needed since there is nothing to lose a
   * race against (the admin themselves just proved possession of both
   * factors).
   */
  resetLoginFailureState(adminId: string): Promise<Admin>;
}
