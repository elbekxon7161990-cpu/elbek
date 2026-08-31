import type { DetectedLanguage } from '../ai-extraction/transaction-extraction-schema';
import type { CategoryDefaultType, CustomCategory } from '../entities/custom-category.entity';

/**
 * DI token for @afa/infrastructure's implementation (a later part), same
 * Symbol-token pattern as USER_REPOSITORY.
 */
export const CATEGORY_REPOSITORY = Symbol('CATEGORY_REPOSITORY');

/**
 * Minimal projection of `categories` (§13.8) — just enough for Create/Edit
 * Transaction to validate a category reference. Full category modeling
 * (translations, hierarchy, custom categories) belongs to its own task
 * (TASK-FIN-006), not this one.
 */
export interface CategoryReference {
  id: string;
  /**
   * The stable taxonomy code (e.g. `'FOOD_DINING'`) — TASK-FIN-014's own
   * resolved-name-not-raw-UUID requirement (FR-EXP2-007) uses this, same
   * code value already shown as-is everywhere else in this codebase's
   * user-facing text (e.g. `renderConfirmationMessage`). Not a localized
   * display name — full category translation modeling is still
   * TASK-FIN-006's own deferred scope.
   *
   * Optional (not backfilled onto every existing call site/fixture) —
   * `PrismaCategoryRepository`'s real implementation always populates it;
   * only test fixtures pre-dating TASK-FIN-014 omit it, which stays valid
   * since none of them resolve a display name from this port.
   */
  code?: string;
  status: 'active' | 'deprecated';
}

/**
 * TASK-FIN-006 — an active system category, as offered to a user picking a
 * parent for their new custom category (BR-SET-001). `label` is the
 * category's translated display name in the requested `language` — falls
 * back to `code` only if a translation row is somehow missing (defensive;
 * the seed always provides all three languages).
 */
export interface SystemCategoryOption {
  id: string;
  code: string;
  label: string;
  defaultType: CategoryDefaultType;
  icon: string | null;
}

/** TASK-FIN-006 — insert shape for a brand-new custom category; `name` is written to a single `category_translations` row (see `CustomCategory`'s own doc comment for why not three). */
export interface NewCustomCategoryData {
  ownerUserId: string;
  name: string;
  language: DetectedLanguage;
  parentCategoryId: string;
  defaultType: CategoryDefaultType;
}

/** TASK-FIN-006 (§7.4.7/§11.7.6-mirrored delete+re-tag) — `null` means the category didn't exist, wasn't owned by `ownerUserId`, or was already deprecated (idempotent-safe double-delete, same "atomic conditional write returns null" contract as `TransactionRepository.softDelete`/`restore`). */
export interface CustomCategoryDeletionResult {
  category: CustomCategory;
  parentCategoryId: string;
  reassignedTransactionCount: number;
}

/**
 * Port (Chapter 3 §3.3.9 hexagonal boundary). BR-EXP-001 — a transaction
 * must reference an existing, non-deprecated category.
 *
 * `findByCode` — TASK-FIN-REAL-001's addition, resolving the gap TASK-BOT-002
 * first reported: AI-extracted candidates (`TransactionExtractionCandidate.category`)
 * carry a stable *code* (e.g. `'FOOD_DINING'`, §4.7.2's taxonomy — the same
 * codes seeded into `categories.code`, a `@unique` column, by
 * packages/infrastructure/prisma/seed.ts), never the database UUID
 * `CreateExpenseUseCase`/`CreateIncomeUseCase` require. This is an additive
 * lookup against the *same* `categories` table `findById` already queries —
 * not a new data source, not a duplicated taxonomy.
 */
export interface CategoryRepository {
  findById(id: string): Promise<CategoryReference | null>;
  findByCode(code: string): Promise<CategoryReference | null>;

  /** BR-SET-001's parent picker — every active, system category, translated into `language`. */
  listActiveSystemCategories(language: DetectedLanguage): Promise<SystemCategoryOption[]>;

  /** Server-side re-verification of a user-chosen parent (never trust a raw id from a callback) — `code` is the same stable, deterministic identifier already used everywhere else in this codebase (`FOOD_DINING`, etc.), resolved only against active, `is_system = true` rows. */
  findActiveSystemCategoryByCode(
    code: string,
    language: DetectedLanguage,
  ): Promise<SystemCategoryOption | null>;

  /**
   * FR-SET-003 — true if `normalizedName` (already run through
   * `normalizeCategoryNameForComparison`) collides with ANY system
   * category's translated label (any of the 3 languages) or with any of
   * `ownerUserId`'s own existing active custom category names. Implementations
   * MUST also enforce this at the database level via a unique index (the
   * real concurrent-duplicate-create guard) — this method is the
   * fail-fast/friendly-error path, not the sole protection.
   */
  isDuplicateCategoryName(ownerUserId: string, normalizedName: string): Promise<boolean>;

  createCustomCategory(input: NewCustomCategoryData): Promise<CustomCategory>;

  /** FR-FIN-019 — active only ("hidden from selection" once deprecated), scoped to `ownerUserId` (BR-FIN-005 per-user taxonomy). */
  listCustomCategoriesForUser(ownerUserId: string): Promise<CustomCategory[]>;

  /** Ownership-scoped read — returns `null` for another user's category (never distinguishes "doesn't exist" from "not yours" to the caller, so a forged id can't be used to probe existence). */
  findCustomCategoryById(id: string, ownerUserId: string): Promise<CustomCategory | null>;

  /** The translated display label for ANY category (system or custom) by id — used to render a custom category's parent name in delete-preview/result messages. */
  findCategoryLabelById(id: string, language: DetectedLanguage): Promise<string | null>;

  /**
   * §7.4.7/§11.7.6-mirrored atomic delete: in a single database transaction,
   * (1) reassigns every non-deleted transaction referencing this category to
   * its mandatory parent, (2) sets `status = 'deprecated'` and
   * `replacement_category_id = parentCategoryId`. Implementations MUST
   * perform this as one atomic conditional operation scoped to
   * `id + ownerUserId + status = 'active'`, returning `null` when no row was
   * actually transitioned by THIS call (not found, not owned, or already
   * deprecated by an earlier/concurrent call) — the same idempotent-safe
   * double-delete contract as `TransactionRepository.softDelete`.
   */
  deleteAndReassignTransactions(
    id: string,
    ownerUserId: string,
  ): Promise<CustomCategoryDeletionResult | null>;
}
