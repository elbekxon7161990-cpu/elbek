import type { CustomCategory } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomCategoryNotFoundError } from '../errors/custom-category-not-found.error';
import { DeleteCustomCategoryUseCase } from './delete-custom-category.use-case';

function makeCustomCategory(overrides: Partial<CustomCategory> = {}): CustomCategory {
  return {
    id: 'custom-1',
    ownerUserId: 'user-1',
    name: "Kids' Football Club",
    parentCategoryId: 'sys-education',
    defaultType: 'expense',
    status: 'active',
    replacementCategoryId: null,
    createdAt: new Date('2026-01-01'),
    isDeleted: false,
    ...overrides,
  } as CustomCategory;
}

describe('DeleteCustomCategoryUseCase (TASK-FIN-006, §7.4.7/§11.7.6-mirrored delete+re-tag)', () => {
  let categoryRepository: {
    findCustomCategoryById: ReturnType<typeof vi.fn>;
    findCategoryLabelById: ReturnType<typeof vi.fn>;
    deleteAndReassignTransactions: ReturnType<typeof vi.fn>;
  };
  let transactionRepository: { countActiveByCategoryId: ReturnType<typeof vi.fn> };
  let useCase: DeleteCustomCategoryUseCase;

  beforeEach(() => {
    categoryRepository = {
      findCustomCategoryById: vi.fn(),
      findCategoryLabelById: vi.fn(),
      deleteAndReassignTransactions: vi.fn(),
    };
    transactionRepository = { countActiveByCategoryId: vi.fn() };
    useCase = new DeleteCustomCategoryUseCase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      categoryRepository as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transactionRepository as any,
    );
  });

  describe('preview', () => {
    it('shows the parent label and affected transaction count BEFORE anything is deleted (worked example §7.9.6)', async () => {
      const category = makeCustomCategory();
      categoryRepository.findCustomCategoryById.mockResolvedValue(category);
      categoryRepository.findCategoryLabelById.mockResolvedValue('Education');
      transactionRepository.countActiveByCategoryId.mockResolvedValue(3);

      const preview = await useCase.preview('custom-1', 'user-1', 'en');

      expect(preview).toEqual({ category, parentLabel: 'Education', affectedTransactionCount: 3 });
      expect(categoryRepository.deleteAndReassignTransactions).not.toHaveBeenCalled();
    });

    it('throws CustomCategoryNotFoundError for a nonexistent category, never leaking a raw null', async () => {
      categoryRepository.findCustomCategoryById.mockResolvedValue(null);

      await expect(useCase.preview('missing', 'user-1', 'en')).rejects.toThrow(
        CustomCategoryNotFoundError,
      );
    });

    it("throws CustomCategoryNotFoundError for another user's category — cross-user isolation, never distinguishes 'not found' from 'not yours'", async () => {
      categoryRepository.findCustomCategoryById.mockResolvedValue(null);

      await expect(useCase.preview('custom-1', 'user-b', 'en')).rejects.toThrow(
        CustomCategoryNotFoundError,
      );
      expect(categoryRepository.findCustomCategoryById).toHaveBeenCalledWith('custom-1', 'user-b');
    });
  });

  describe('execute', () => {
    it('deletes and re-tags, returning the real reassigned count and parent label (happy path)', async () => {
      categoryRepository.deleteAndReassignTransactions.mockResolvedValue({
        category: makeCustomCategory({ status: 'deprecated', replacementCategoryId: 'sys-education' }),
        parentCategoryId: 'sys-education',
        reassignedTransactionCount: 3,
      });
      categoryRepository.findCategoryLabelById.mockResolvedValue('Education');

      const result = await useCase.execute('custom-1', 'user-1', 'en');

      expect(result).toEqual({
        category: expect.objectContaining({ status: 'deprecated' }),
        parentLabel: 'Education',
        reassignedTransactionCount: 3,
      });
    });

    it('a second delete of the same already-deprecated category returns null, never a second reversal', async () => {
      categoryRepository.deleteAndReassignTransactions.mockResolvedValue(null);

      const result = await useCase.execute('custom-1', 'user-1', 'en');

      expect(result).toBeNull();
      expect(categoryRepository.findCategoryLabelById).not.toHaveBeenCalled();
    });

    it('passes the exact given ownerUserId through to the atomic repository call — cross-user isolation', async () => {
      categoryRepository.deleteAndReassignTransactions.mockResolvedValue(null);

      await useCase.execute('custom-1', 'user-abc-123', 'en');

      expect(categoryRepository.deleteAndReassignTransactions).toHaveBeenCalledWith(
        'custom-1',
        'user-abc-123',
      );
    });
  });
});
