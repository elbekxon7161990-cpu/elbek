import { Inject, Injectable } from '@nestjs/common';
import type { User, UserRepository } from '@afa/domain';
import { USER_REPOSITORY } from '@afa/domain';

/** Web admin panel's single-user lookup (view a user's detail row). */
@Injectable()
export class GetUserByIdUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly userRepository: UserRepository) {}

  async execute(userId: string): Promise<User | null> {
    return this.userRepository.findById(userId);
  }
}
