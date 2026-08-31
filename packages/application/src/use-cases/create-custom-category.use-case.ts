import { Inject, Injectable } from '@nestjs/common';
import type {
  CategoryRepository,
  CustomCategory,
  DetectedLanguage,
  SystemCategoryOption,
} from '@afa/domain';
import {
  CATEGORY_REPOSITORY,
  CustomCategory as CustomCategoryEntity,
  DuplicateCategoryNameError,
  normalizeCategoryNameForComparison,
} from '@afa/domain';

/**
 * TASK-FIN-006 (Chapter 7 §7.4.5 FR-SET-003, §7.4.6 BR-SET-001, §7.9.6's
 * worked example: name first, then parent selection).
 */
export interface CreateCustomCategoryInput {
  userId: string;
  name: string;
  language: DetectedLanguage;
  /** The stable code of the chosen parent SYSTEM category (e.g. `'EDUCATION'`) — never a raw database id trusted from a callback; re-verified server-side against active, `is_system = true` rows. */
  parentCategoryCode: string;
}

export type CreateCustomCategoryOutcome =
  | { kind: 'created'; category: CustomCategory; parentLabel: string }
  | { kind: 'duplicate_name' }
  | { kind: 'invalid_parent' };

export type NameAvailability = 'available' | 'invalid' | 'duplicate';

@Injectable()
export class CreateCustomCategoryUseCase {
  constructor(@Inject(CATEGORY_REPOSITORY) private readonly categoryRepository: CategoryRepository) {}

  /** BR-SET-001's parent picker — every active system category, translated into `language`. */
  async listParentOptions(language: DetectedLanguage): Promise<SystemCategoryOption[]> {
    return this.categoryRepository.listActiveSystemCategories(language);
  }

  /**
   * §7.9.6's worked example — FR-SET-003's duplicate check runs right after
   * the name is typed, BEFORE the parent prompt (step 3, before step 4) —
   * this is that check, callable on its own so the Telegram wizard's
   * "awaiting name" step can give immediate feedback rather than deferring
   * validation until after parent selection.
   */
  async checkNameAvailability(userId: string, name: string): Promise<NameAvailability> {
    try {
      CustomCategoryEntity.validateName(name);
    } catch {
      return 'invalid';
    }
    const isDuplicate = await this.categoryRepository.isDuplicateCategoryName(
      userId,
      normalizeCategoryNameForComparison(name),
    );
    return isDuplicate ? 'duplicate' : 'available';
  }

  async execute(input: CreateCustomCategoryInput): Promise<CreateCustomCategoryOutcome> {
    // Throws InvalidCustomCategoryError for empty/too-long input — a caller
    // bug (the Telegram layer already validates before reaching here), not
    // a business outcome this use case's own return type models.
    CustomCategoryEntity.validateName(input.name);

    const parent = await this.categoryRepository.findActiveSystemCategoryByCode(
      input.parentCategoryCode,
      input.language,
    );
    if (!parent) {
      return { kind: 'invalid_parent' };
    }

    const normalizedName = normalizeCategoryNameForComparison(input.name);
    const isDuplicate = await this.categoryRepository.isDuplicateCategoryName(
      input.userId,
      normalizedName,
    );
    if (isDuplicate) {
      return { kind: 'duplicate_name' };
    }

    try {
      const category = await this.categoryRepository.createCustomCategory({
        ownerUserId: input.userId,
        name: input.name,
        language: input.language,
        parentCategoryId: parent.id,
        // This task's own inferred default (see `CustomCategory`'s own doc
        // comment) — inherited from the parent, never a separate prompt the
        // PRD's worked example never asks for.
        defaultType: parent.defaultType,
      });
      return { kind: 'created', category, parentLabel: parent.label };
    } catch (error) {
      if (error instanceof DuplicateCategoryNameError) {
        return { kind: 'duplicate_name' };
      }
      throw error;
    }
  }
}
