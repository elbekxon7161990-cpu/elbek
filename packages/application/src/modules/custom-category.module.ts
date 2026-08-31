import { Module } from '@nestjs/common';

import { CreateCustomCategoryUseCase } from '../use-cases/create-custom-category.use-case';
import { DeleteCustomCategoryUseCase } from '../use-cases/delete-custom-category.use-case';
import { ListCustomCategoriesUseCase } from '../use-cases/list-custom-categories.use-case';

/**
 * TASK-FIN-006 — Custom Categories (Chapter 7 §7.4, Chapter 8 §8.11). Does
 * not bind `CATEGORY_REPOSITORY`/`TRANSACTION_REPOSITORY` — the composition
 * root's job, same split as every other module in this package.
 */
@Module({
  providers: [CreateCustomCategoryUseCase, ListCustomCategoriesUseCase, DeleteCustomCategoryUseCase],
  exports: [CreateCustomCategoryUseCase, ListCustomCategoriesUseCase, DeleteCustomCategoryUseCase],
})
export class CustomCategoryModule {}
