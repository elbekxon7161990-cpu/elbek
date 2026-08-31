import type { CustomCategory } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ListCustomCategoriesUseCase } from './list-custom-categories.use-case';

describe('ListCustomCategoriesUseCase (TASK-FIN-006, FR-FIN-019/BR-FIN-005)', () => {
  let categoryRepository: { listCustomCategoriesForUser: ReturnType<typeof vi.fn> };
  let useCase: ListCustomCategoriesUseCase;

  beforeEach(() => {
    categoryRepository = { listCustomCategoriesForUser: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useCase = new ListCustomCategoriesUseCase(categoryRepository as any);
  });

  it('delegates straight to the repository, scoped to the given user', async () => {
    const categories = [{ id: 'c1' } as CustomCategory];
    categoryRepository.listCustomCategoriesForUser.mockResolvedValue(categories);

    const result = await useCase.execute('user-1');

    expect(categoryRepository.listCustomCategoriesForUser).toHaveBeenCalledWith('user-1');
    expect(result).toBe(categories);
  });

  it('a user with no custom categories gets an empty array, never null/undefined', async () => {
    categoryRepository.listCustomCategoriesForUser.mockResolvedValue([]);

    const result = await useCase.execute('user-1');

    expect(result).toEqual([]);
  });
});
