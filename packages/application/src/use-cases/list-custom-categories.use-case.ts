import { Inject, Injectable } from '@nestjs/common';
import type { CategoryRepository, CustomCategory } from '@afa/domain';
import { CATEGORY_REPOSITORY } from '@afa/domain';

/** TASK-FIN-006 (FR-FIN-019) — active only, scoped to the requesting user (BR-FIN-005). */
@Injectable()
export class ListCustomCategoriesUseCase {
  constructor(@Inject(CATEGORY_REPOSITORY) private readonly categoryRepository: CategoryRepository) {}

  async execute(userId: string): Promise<CustomCategory[]> {
    return this.categoryRepository.listCustomCategoriesForUser(userId);
  }
}
