import type { CustomCategory, SystemCategoryOption } from '@afa/domain';
import { DuplicateCategoryNameError, InvalidCustomCategoryError } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateCustomCategoryUseCase } from './create-custom-category.use-case';

function makeParent(overrides: Partial<SystemCategoryOption> = {}): SystemCategoryOption {
  return {
    id: 'sys-education',
    code: 'EDUCATION',
    label: 'Education',
    defaultType: 'expense',
    icon: null,
    ...overrides,
  };
}

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

describe('CreateCustomCategoryUseCase (TASK-FIN-006, FR-SET-003/BR-SET-001)', () => {
  let categoryRepository: {
    findActiveSystemCategoryByCode: ReturnType<typeof vi.fn>;
    isDuplicateCategoryName: ReturnType<typeof vi.fn>;
    createCustomCategory: ReturnType<typeof vi.fn>;
    listActiveSystemCategories: ReturnType<typeof vi.fn>;
  };
  let useCase: CreateCustomCategoryUseCase;

  beforeEach(() => {
    categoryRepository = {
      findActiveSystemCategoryByCode: vi.fn(),
      isDuplicateCategoryName: vi.fn(),
      createCustomCategory: vi.fn(),
      listActiveSystemCategories: vi.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useCase = new CreateCustomCategoryUseCase(categoryRepository as any);
  });

  it('creates successfully when the name is unique and the parent is a valid active system category (happy path)', async () => {
    categoryRepository.findActiveSystemCategoryByCode.mockResolvedValue(makeParent());
    categoryRepository.isDuplicateCategoryName.mockResolvedValue(false);
    const created = makeCustomCategory();
    categoryRepository.createCustomCategory.mockResolvedValue(created);

    const outcome = await useCase.execute({
      userId: 'user-1',
      name: "Kids' Football Club",
      language: 'en',
      parentCategoryCode: 'EDUCATION',
    });

    expect(outcome).toEqual({ kind: 'created', category: created, parentLabel: 'Education' });
    expect(categoryRepository.createCustomCategory).toHaveBeenCalledWith({
      ownerUserId: 'user-1',
      name: "Kids' Football Club",
      language: 'en',
      parentCategoryId: 'sys-education',
      defaultType: 'expense',
    });
  });

  it('inherits defaultType from the chosen parent, never a separate user-supplied value', async () => {
    categoryRepository.findActiveSystemCategoryByCode.mockResolvedValue(
      makeParent({ defaultType: 'income' }),
    );
    categoryRepository.isDuplicateCategoryName.mockResolvedValue(false);
    categoryRepository.createCustomCategory.mockResolvedValue(makeCustomCategory());

    await useCase.execute({
      userId: 'user-1',
      name: 'Side Hustle',
      language: 'en',
      parentCategoryCode: 'FREELANCE_INCOME',
    });

    expect(categoryRepository.createCustomCategory).toHaveBeenCalledWith(
      expect.objectContaining({ defaultType: 'income' }),
    );
  });

  it('rejects an empty name before ever touching the repository (domain invariant)', async () => {
    await expect(
      useCase.execute({ userId: 'user-1', name: '   ', language: 'en', parentCategoryCode: 'EDUCATION' }),
    ).rejects.toThrow(InvalidCustomCategoryError);
    expect(categoryRepository.findActiveSystemCategoryByCode).not.toHaveBeenCalled();
  });

  it('rejects a name over the max length before ever touching the repository (domain invariant)', async () => {
    await expect(
      useCase.execute({
        userId: 'user-1',
        name: 'x'.repeat(61),
        language: 'en',
        parentCategoryCode: 'EDUCATION',
      }),
    ).rejects.toThrow(InvalidCustomCategoryError);
  });

  it('an unrecognized/inactive parent code returns invalid_parent, never guesses a fallback parent', async () => {
    categoryRepository.findActiveSystemCategoryByCode.mockResolvedValue(null);

    const outcome = await useCase.execute({
      userId: 'user-1',
      name: 'Side Hustle',
      language: 'en',
      parentCategoryCode: 'NOT_A_REAL_CODE',
    });

    expect(outcome).toEqual({ kind: 'invalid_parent' });
    expect(categoryRepository.isDuplicateCategoryName).not.toHaveBeenCalled();
    expect(categoryRepository.createCustomCategory).not.toHaveBeenCalled();
  });

  it('a duplicate name (app-level pre-check) returns duplicate_name, never creates a second one', async () => {
    categoryRepository.findActiveSystemCategoryByCode.mockResolvedValue(makeParent());
    categoryRepository.isDuplicateCategoryName.mockResolvedValue(true);

    const outcome = await useCase.execute({
      userId: 'user-1',
      name: 'Food',
      language: 'en',
      parentCategoryCode: 'EDUCATION',
    });

    expect(outcome).toEqual({ kind: 'duplicate_name' });
    expect(categoryRepository.createCustomCategory).not.toHaveBeenCalled();
  });

  it('a DuplicateCategoryNameError from the atomic DB write (concurrent race) also maps to duplicate_name, never propagates as an internal error', async () => {
    categoryRepository.findActiveSystemCategoryByCode.mockResolvedValue(makeParent());
    categoryRepository.isDuplicateCategoryName.mockResolvedValue(false);
    categoryRepository.createCustomCategory.mockRejectedValue(new DuplicateCategoryNameError('Food'));

    const outcome = await useCase.execute({
      userId: 'user-1',
      name: 'Food',
      language: 'en',
      parentCategoryCode: 'EDUCATION',
    });

    expect(outcome).toEqual({ kind: 'duplicate_name' });
  });

  it('propagates any other repository error rather than swallowing it', async () => {
    categoryRepository.findActiveSystemCategoryByCode.mockResolvedValue(makeParent());
    categoryRepository.isDuplicateCategoryName.mockResolvedValue(false);
    categoryRepository.createCustomCategory.mockRejectedValue(new Error('P2028 db internal detail'));

    await expect(
      useCase.execute({
        userId: 'user-1',
        name: 'Food',
        language: 'en',
        parentCategoryCode: 'EDUCATION',
      }),
    ).rejects.toThrow('P2028 db internal detail');
  });

  describe('checkNameAvailability', () => {
    it("returns 'invalid' for an empty name without touching the repository", async () => {
      const result = await useCase.checkNameAvailability('user-1', '   ');
      expect(result).toBe('invalid');
      expect(categoryRepository.isDuplicateCategoryName).not.toHaveBeenCalled();
    });

    it("returns 'duplicate' when the repository reports a collision", async () => {
      categoryRepository.isDuplicateCategoryName.mockResolvedValue(true);
      const result = await useCase.checkNameAvailability('user-1', 'Food');
      expect(result).toBe('duplicate');
    });

    it("returns 'available' for a valid, non-colliding name", async () => {
      categoryRepository.isDuplicateCategoryName.mockResolvedValue(false);
      const result = await useCase.checkNameAvailability('user-1', "Kids' Football Club");
      expect(result).toBe('available');
    });
  });

  it('listParentOptions delegates straight to the repository', async () => {
    const options = [makeParent()];
    categoryRepository.listActiveSystemCategories.mockResolvedValue(options);

    const result = await useCase.listParentOptions('ru');

    expect(categoryRepository.listActiveSystemCategories).toHaveBeenCalledWith('ru');
    expect(result).toBe(options);
  });
});
