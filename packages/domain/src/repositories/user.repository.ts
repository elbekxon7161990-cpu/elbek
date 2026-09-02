import type { User } from '../entities/user.entity';

/**
 * DI token for @afa/infrastructure's Prisma-backed implementation, bound by
 * each apps/* composition root. Same Symbol-token pattern as
 * packages/infrastructure/src/redis/redis.constants.ts's REDIS_CLIENT.
 */
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface NewUserData {
  telegramUserId: bigint;
  telegramUsername?: string;
  displayName?: string;
  preferredLanguage?: string;
}

/** §13.4's `users.status` CHECK constraint values — `User.status` itself stays plain `string` on the entity (see that class's own doc comment); this is only for the admin-panel-facing list/filter/block surface below. */
export type UserStatus = 'active' | 'deactivated' | 'pending_deletion' | 'deleted';

export interface ListUsersParams {
  status?: UserStatus;
  limit: number;
  offset: number;
}

export interface CountUsersParams {
  status?: UserStatus;
}

/**
 * Port (Chapter 3 §3.3.9 hexagonal boundary) — implemented by
 * packages/infrastructure, consumed by @afa/application use-cases via
 * USER_REPOSITORY. BR-AUTH-001: telegramUserId is the unique identity key.
 */
export interface UserRepository {
  findByTelegramUserId(telegramUserId: bigint): Promise<User | null>;
  /**
   * TASK-FIN-001 Part 2 — Create Expense/Income verify the requesting user
   * still exists before creating a transaction against it.
   */
  findById(id: string): Promise<User | null>;
  create(data: NewUserData): Promise<User>;
  /** BR-AUTH-002 — reactivates a `deactivated` user back to `active`. */
  reactivate(id: string): Promise<User>;
  /**
   * TASK-AUTH-006 (FR-RET-001) — atomic conditional transition, `'active'`
   * only. Mirrors `TransactionRepository.softDelete`'s own atomic-
   * conditional-write discipline: never a read-then-write, so two
   * concurrent requests can never both "win". Returns `null` (never throws)
   * when the user was not `'active'` at the moment of the write — already
   * `'pending_deletion'`/`'deleted'`/`'deactivated'`, or a genuine race —
   * the caller decides how to respond, this port makes no policy choice
   * beyond the transition itself.
   */
  requestDeletion(userId: string, requestedAt: Date): Promise<User | null>;
  /**
   * TASK-AUTH-006 (FR-RET-001 — "recoverable if the user reverses the
   * request"). Same atomic-conditional shape as `requestDeletion`, the
   * exact inverse transition (`'pending_deletion'` only), clearing
   * `deletionRequestedAt`. Returns `null` when the user was not
   * `'pending_deletion'` at the moment of the write.
   *
   * `now` is part of the WHERE clause, not just an input to compute with:
   * the write additionally requires `deletionRequestedAt` to still be
   * within the grace period as of `now` (§`account-deletion-grace-period.ts`).
   * This is what makes cancellation and the scheduled purge mutually
   * exclusive WITHOUT any extra lock — a user whose grace period has
   * already elapsed fails this condition by construction, the same instant
   * `findExpiredPendingDeletions` would first surface them as a purge
   * candidate for that same `now`. See `PrismaAccountPurgeRepository`'s own
   * doc comment for the full argument.
   */
  cancelDeletion(userId: string, now: Date): Promise<User | null>;
  /**
   * TASK-AUTH-006 (FR-RET-002) — purge-candidate selection: every
   * `pending_deletion` user whose grace period has actually elapsed as of
   * `now` (`deletionRequestedAt <= now - 30d`), using the exact same cutoff
   * `cancelDeletion` itself is guarded against. Read-only; the scheduled
   * purge job re-derives eligibility from these same rows, not from this
   * method deciding anything beyond "who qualifies right now."
   */
  findExpiredPendingDeletions(now: Date): Promise<User[]>;
  /**
   * FR-PROF-002/FR-SET-001/004 — updates only the given fields, leaving
   * everything else (including any field omitted from `data`) untouched.
   * Every value here is validated by the caller BEFORE this method runs
   * (`UpdateUserProfileUseCase` — `preferredLanguage` against the real
   * `DetectedLanguage` enum, `defaultCurrency` against `CurrencyRepository`,
   * `timezone` against `isValidIanaTimezone`); this port makes no validation
   * decision of its own, the same "port does no policy, caller decides"
   * split every other conditional-write method on this interface follows.
   */
  updateProfile(
    userId: string,
    data: Partial<{
      preferredLanguage: string;
      defaultCurrency: string;
      timezone: string;
    }>,
  ): Promise<User>;
  /**
   * Admin-panel user-management surface — atomic conditional transition,
   * `'active'` only, same shape as `requestDeletion`/`cancelDeletion` above
   * (never a read-then-write). Returns `null` when the user was not
   * `'active'` at the moment of the write; the caller decides how to
   * respond. The inverse transition reuses `reactivate()` above unchanged —
   * `'deactivated'` → `'active'` is the same operation regardless of
   * whether the user reactivated themselves or an admin unblocked them.
   */
  block(userId: string): Promise<User | null>;
  /** Admin-panel user list — paginated, optionally filtered by status, newest first. */
  listUsers(params: ListUsersParams): Promise<User[]>;
  /** Total row count for the same filter `listUsers` would apply — for pagination. */
  countUsers(params: CountUsersParams): Promise<number>;
}
