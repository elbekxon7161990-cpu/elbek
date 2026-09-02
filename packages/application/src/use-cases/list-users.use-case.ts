import { Inject, Injectable } from '@nestjs/common';
import type { User, UserRepository, UserStatus } from '@afa/domain';
import { USER_REPOSITORY } from '@afa/domain';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export interface ListUsersInput {
  status?: UserStatus;
  limit?: number;
  offset?: number;
}

export interface ListUsersResult {
  users: readonly User[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Admin panel's user list/management view. Clamps `limit`/`offset` itself
 * (port makes no policy decision beyond the query itself, same split every
 * other use case in this codebase follows) — never trusts the caller's
 * pagination input directly against the database.
 */
@Injectable()
export class ListUsersUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly userRepository: UserRepository) {}

  async execute(input: ListUsersInput): Promise<ListUsersResult> {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(input.offset ?? 0, 0);

    const [users, total] = await Promise.all([
      this.userRepository.listUsers({ status: input.status, limit, offset }),
      this.userRepository.countUsers({ status: input.status }),
    ]);

    return { users, total, limit, offset };
  }
}
