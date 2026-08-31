import { isNonEmptyString } from './decimal-amount';
import { InvalidCustomCategoryError } from '../errors/invalid-custom-category.error';

/**
 * TASK-FIN-006 (Chapter 7 §7.4 Settings, Chapter 8 §8.11 Categories,
 * BR-SET-001, FR-SET-003, FR-FIN-018/019).
 *
 * A user-created category, always mapped to exactly one parent SYSTEM
 * category (BR-SET-001 — never another custom category, never optional,
 * decided at creation time). Mirrors `categories`' own schema (§13.8):
 * `id`, `owner_user_id`, `parent_category_id`, `default_type`, `status`
 * ('active'|'deprecated'), `replacement_category_id` (set only once
 * deprecated). The display name itself lives in `category_translations`
 * (one row, in the language the user typed it in — see this task's own
 * final report for why translating a private, user-chosen label into the
 * other two languages serves no purpose the PRD describes), not on this
 * entity, which is why `name` here is a plain string, not a translation map.
 */
export type CategoryDefaultType = 'expense' | 'income' | 'neutral';
export type CustomCategoryStatus = 'active' | 'deprecated';

const DEFAULT_TYPES: readonly CategoryDefaultType[] = ['expense', 'income', 'neutral'];
const STATUSES: readonly CustomCategoryStatus[] = ['active', 'deprecated'];

/**
 * No PRD-stated maximum for a category name — this is this codebase's own
 * inferred bound for a short, glanceable label (consistent with how every
 * other short free-text field in this codebase — e.g. an account name — is
 * kept intentionally brief), not a schema/PRD requirement.
 */
export const CUSTOM_CATEGORY_NAME_MAX_LENGTH = 60;

export interface CustomCategoryProps {
  id: string;
  ownerUserId: string;
  name: string;
  /** The chosen parent SYSTEM category's id — BR-SET-001, mandatory. */
  parentCategoryId: string;
  /** Inherited from the parent system category at creation time (this task's own inferred default — the PRD's worked example never asks the user to separately pick expense/income/neutral). */
  defaultType: CategoryDefaultType;
  status: CustomCategoryStatus;
  /** Set exactly when `status === 'deprecated'` — always the same id as `parentCategoryId` (deleting a custom category always "replaces" it with its own mandatory parent, §7.4.7). */
  replacementCategoryId: string | null;
  createdAt: Date;
}

export type NewCustomCategoryValidationProps = Omit<
  CustomCategoryProps,
  'id' | 'createdAt' | 'status' | 'replacementCategoryId'
>;

export class CustomCategory {
  readonly id: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly parentCategoryId: string;
  readonly defaultType: CategoryDefaultType;
  readonly status: CustomCategoryStatus;
  readonly replacementCategoryId: string | null;
  readonly createdAt: Date;

  constructor(props: CustomCategoryProps) {
    CustomCategory.validate(props);
    this.id = props.id;
    this.ownerUserId = props.ownerUserId;
    this.name = props.name.trim();
    this.parentCategoryId = props.parentCategoryId;
    this.defaultType = props.defaultType;
    this.status = props.status;
    this.replacementCategoryId = props.replacementCategoryId;
    this.createdAt = props.createdAt;
  }

  private static validate(props: CustomCategoryProps): void {
    if (!isNonEmptyString(props.id)) {
      throw new InvalidCustomCategoryError('CustomCategory id is required.');
    }
    if (!isNonEmptyString(props.ownerUserId)) {
      throw new InvalidCustomCategoryError('CustomCategory ownerUserId is required.');
    }
    CustomCategory.validateName(props.name);
    if (!isNonEmptyString(props.parentCategoryId)) {
      // BR-SET-001 — a custom category always maps to a parent system
      // category; mandatory at creation, never optional.
      throw new InvalidCustomCategoryError(
        'A custom category must reference a parent system category.',
      );
    }
    if (!DEFAULT_TYPES.includes(props.defaultType)) {
      throw new InvalidCustomCategoryError(`Invalid defaultType: "${String(props.defaultType)}".`);
    }
    if (!STATUSES.includes(props.status)) {
      throw new InvalidCustomCategoryError(`Invalid status: "${String(props.status)}".`);
    }
    if (props.status === 'deprecated' && !isNonEmptyString(props.replacementCategoryId ?? '')) {
      // Mirrors BR-ADM-002's non-destructive-deprecation rule, restated here
      // as a domain invariant: a deprecated category always carries the
      // replacement its transactions were migrated to — never a dangling
      // "deprecated with nowhere to go" state.
      throw new InvalidCustomCategoryError(
        'A deprecated custom category must carry a replacementCategoryId.',
      );
    }
  }

  /** FR-SET-003 — empty/whitespace-only rejected; trimmed; bounded length. */
  static validateName(name: string): void {
    if (!isNonEmptyString(name)) {
      throw new InvalidCustomCategoryError('Category name cannot be empty.');
    }
    if (name.trim().length > CUSTOM_CATEGORY_NAME_MAX_LENGTH) {
      throw new InvalidCustomCategoryError(
        `Category name cannot exceed ${CUSTOM_CATEGORY_NAME_MAX_LENGTH} characters.`,
      );
    }
  }

  /** Validates a not-yet-persisted custom category (`CreateCustomCategoryUseCase`) without requiring persistence-assigned fields. */
  static validateNew(props: NewCustomCategoryValidationProps, now: Date = new Date()): void {
    CustomCategory.validate({
      ...props,
      id: 'pending',
      status: 'active',
      replacementCategoryId: null,
      createdAt: now,
    });
  }

  get isDeleted(): boolean {
    return this.status === 'deprecated';
  }
}

/**
 * FR-SET-003 — the "case/language-insensitive" comparison key: trim +
 * Unicode NFKC-normalize + locale-lowercase, so "Food", " food ", and
 * case/diacritic variants of the same literal text collide as the same
 * candidate. This is NOT cross-language *semantic* matching (typing
 * "Oziq-ovqat" will not be detected as a duplicate of a system category
 * whose English label is "Food") — that would need translation/AI
 * infrastructure this codebase doesn't have anywhere else, and isn't
 * required here because every system category's label already exists in
 * all three languages (`category_translations`), so the real "language-
 * insensitive" requirement — checking the candidate against every stored
 * language variant, not just the user's current one — is fully satisfied by
 * comparing against ALL of a system category's translation rows, unchanged.
 */
export function normalizeCategoryNameForComparison(name: string): string {
  return name.trim().normalize('NFKC').toLocaleLowerCase();
}
