import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type {
  CategoryDefaultType,
  CategoryReference,
  CategoryRepository,
  CustomCategory,
  CustomCategoryDeletionResult,
  CustomCategoryStatus,
  DetectedLanguage,
  NewCustomCategoryData,
  SystemCategoryOption,
} from '@afa/domain';
import {
  CustomCategory as CustomCategoryEntity,
  DuplicateCategoryNameError,
  normalizeCategoryNameForComparison,
} from '@afa/domain';
import { getCurrentUserId } from '@afa/shared';

import { PRISMA_BASE_CLIENT } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';

interface CategoryRowWithTranslations {
  id: string;
  ownerUserId: string | null;
  parentCategoryId: string | null;
  defaultType: string;
  status: string;
  replacementCategoryId: string | null;
  createdAt: Date;
  translations: { label: string }[];
}

/**
 * TASK-FIN-001 Part 3 — queries the existing `categories` reference table
 * (§13.8; no new schema). Only ever returns the minimal `CategoryReference`
 * projection the domain port declares, never the full Prisma `Category`
 * model (translations, hierarchy, etc. stay internal to this package).
 *
 * TASK-FIN-006 extends this with the Custom Categories surface. `Category`/
 * `CategoryTranslation` are now RLS-protected (migration
 * `20260830000000_custom_categories`) — every method below except the two
 * multi-table atomic writes (`createCustomCategory`,
 * `deleteAndReassignTransactions`) goes through `this.prisma` (the
 * RLS-extended client) exactly like every other method in this codebase;
 * those two use `PRISMA_BASE_CLIENT` + manual `set_config`, the same
 * established pattern `PrismaTransactionRepository.create()`/`softDelete()`
 * already use for a multi-table atomic write the extension's own
 * one-operation-at-a-time wrapping can't express — see this class's own
 * method-level doc comments.
 */
@Injectable()
export class PrismaCategoryRepository implements CategoryRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PRISMA_BASE_CLIENT) private readonly basePrisma: PrismaService,
  ) {}

  async findById(id: string): Promise<CategoryReference | null> {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true, code: true, status: true },
    });
    return this.toCategoryReference(category);
  }

  /** TASK-FIN-REAL-001 — `code` is `@unique` on the `categories` table, so this is a single indexed lookup, same query shape as `findById`. */
  async findByCode(code: string): Promise<CategoryReference | null> {
    const category = await this.prisma.category.findUnique({
      where: { code },
      select: { id: true, code: true, status: true },
    });
    return this.toCategoryReference(category);
  }

  /** BR-SET-001's parent picker. */
  async listActiveSystemCategories(language: DetectedLanguage): Promise<SystemCategoryOption[]> {
    const rows = await this.prisma.category.findMany({
      where: { isSystem: true, status: 'active' },
      include: { translations: { where: { language } } },
      orderBy: { code: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      label: row.translations[0]?.label ?? row.code,
      defaultType: row.defaultType as CategoryDefaultType,
      icon: row.icon,
    }));
  }

  /** Server-side re-verification of a user-chosen parent — resolved only against active, `is_system = true` rows, never trusting a raw id from a callback. */
  async findActiveSystemCategoryByCode(
    code: string,
    language: DetectedLanguage,
  ): Promise<SystemCategoryOption | null> {
    const row = await this.prisma.category.findFirst({
      where: { code, isSystem: true, status: 'active' },
      include: { translations: { where: { language } } },
    });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      code: row.code,
      label: row.translations[0]?.label ?? row.code,
      defaultType: row.defaultType as CategoryDefaultType,
      icon: row.icon,
    };
  }

  /** FR-SET-003 — see the port's own doc comment for the exact matching rule. */
  async isDuplicateCategoryName(ownerUserId: string, normalizedName: string): Promise<boolean> {
    const match = await this.prisma.categoryTranslation.findFirst({
      where: {
        label: { equals: normalizedName, mode: 'insensitive' },
        OR: [
          { ownerUserId: null, category: { isSystem: true, status: 'active' } },
          { ownerUserId, category: { status: 'active' } },
        ],
      },
      select: { categoryId: true },
    });
    return match !== null;
  }

  /**
   * Two-table atomic insert (`categories` + `category_translations`), both
   * now RLS-protected — same `basePrisma.$transaction` + manual `set_config`
   * pattern as `PrismaTransactionRepository.create()`'s own paired
   * `transactions`+`domain_events` insert, for the identical reason: the
   * RLS extension wraps one model operation at a time, which cannot express
   * "these two inserts commit together or not at all."
   *
   * `code` is generated here, never caller-supplied — `categories.code` is
   * globally `@unique`; a custom category has no meaningful stable taxonomy
   * code the way a system category does (§4.4.3), so a fresh, collision-proof
   * value is synthesized instead of asking the domain layer to invent one.
   */
  async createCustomCategory(input: NewCustomCategoryData): Promise<CustomCategory> {
    const trimmedName = input.name.trim();
    const userId = getCurrentUserId();
    const code = `CUSTOM_${randomUUID().replace(/-/g, '').toUpperCase()}`;

    try {
      const row = await this.basePrisma.$transaction(async (tx) => {
        if (userId) {
          await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
        }
        const category = await tx.category.create({
          data: {
            code,
            parentCategoryId: input.parentCategoryId,
            defaultType: input.defaultType,
            isSystem: false,
            ownerUserId: input.ownerUserId,
            status: 'active',
          },
        });
        await tx.categoryTranslation.create({
          data: {
            categoryId: category.id,
            language: input.language,
            label: trimmedName,
            ownerUserId: input.ownerUserId,
          },
        });
        return category;
      });

      return new CustomCategoryEntity({
        id: row.id,
        ownerUserId: row.ownerUserId!,
        name: trimmedName,
        parentCategoryId: row.parentCategoryId!,
        defaultType: row.defaultType as CategoryDefaultType,
        status: row.status as CustomCategoryStatus,
        replacementCategoryId: row.replacementCategoryId,
        createdAt: row.createdAt,
      });
    } catch (error) {
      // TASK-FIN-006 — same "re-check on caught write failure" shape
      // `PrismaBudgetRepository.create()` already established: the
      // (owner_user_id, language, lower(label)) partial unique index
      // (migration 20260830000000_custom_categories) is the REAL concurrent-
      // duplicate-create guard; `isDuplicateCategoryName`'s own pre-check is
      // only a fail-fast/friendly-error path, not itself atomic. A genuinely
      // unrelated write failure re-throws unchanged (the re-check below
      // finds no duplicate, so it falls through).
      const stillDuplicate = await this.isDuplicateCategoryName(
        input.ownerUserId,
        normalizeCategoryNameForComparison(trimmedName),
      );
      if (stillDuplicate) {
        throw new DuplicateCategoryNameError(trimmedName);
      }
      throw error;
    }
  }

  /** FR-FIN-019 — active only, scoped to `ownerUserId`. */
  async listCustomCategoriesForUser(ownerUserId: string): Promise<CustomCategory[]> {
    const rows = await this.prisma.category.findMany({
      where: { ownerUserId, status: 'active' },
      include: { translations: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toDomainCustomCategory(row));
  }

  /** Ownership-scoped read, active only (an already-deprecated category is not a valid delete target for a fresh preview). */
  async findCustomCategoryById(id: string, ownerUserId: string): Promise<CustomCategory | null> {
    const row = await this.prisma.category.findFirst({
      where: { id, ownerUserId, status: 'active' },
      include: { translations: true },
    });
    return row ? this.toDomainCustomCategory(row) : null;
  }

  async findCategoryLabelById(id: string, language: DetectedLanguage): Promise<string | null> {
    const translation = await this.prisma.categoryTranslation.findUnique({
      where: { categoryId_language: { categoryId: id, language } },
      select: { label: true },
    });
    return translation?.label ?? null;
  }

  /**
   * §7.4.7/§11.7.6-mirrored atomic delete. The `categories` transition is a
   * raw, atomic conditional `UPDATE ... WHERE id = ? AND owner_user_id = ?
   * AND status = 'active'` (Prisma's query builder can't express "set
   * replacement_category_id to this row's OWN parent_category_id" without a
   * raw statement) — `0` rows affected means not found/not owned/already
   * deprecated, mirroring `TransactionRepository.softDelete`'s own
   * atomic-conditional-write contract exactly. Both the category transition
   * and the transaction re-tagging happen inside the SAME
   * `basePrisma.$transaction`, so they commit or roll back together — never
   * a partially-migrated state.
   */
  async deleteAndReassignTransactions(
    id: string,
    ownerUserId: string,
  ): Promise<CustomCategoryDeletionResult | null> {
    const userId = getCurrentUserId();

    return this.basePrisma.$transaction(async (tx) => {
      if (userId) {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      }

      const updatedCount = await tx.$executeRaw`
        UPDATE categories
        SET status = 'deprecated', replacement_category_id = parent_category_id
        WHERE id = ${id}::uuid AND owner_user_id = ${ownerUserId}::uuid AND status = 'active'
      `;
      if (updatedCount === 0) {
        return null;
      }

      const category = await tx.category.findUniqueOrThrow({
        where: { id },
        include: { translations: true },
      });
      const parentCategoryId = category.parentCategoryId!;

      const [reassignedCategory, reassignedSubcategory] = await Promise.all([
        tx.transaction.updateMany({
          where: { userId: ownerUserId, categoryId: id, deletedAt: null },
          data: { categoryId: parentCategoryId },
        }),
        tx.transaction.updateMany({
          where: { userId: ownerUserId, subcategoryId: id, deletedAt: null },
          data: { subcategoryId: parentCategoryId },
        }),
      ]);

      return {
        category: this.toDomainCustomCategory(category),
        parentCategoryId,
        reassignedTransactionCount: reassignedCategory.count + reassignedSubcategory.count,
      };
    });
  }

  private toDomainCustomCategory(row: CategoryRowWithTranslations): CustomCategory {
    return new CustomCategoryEntity({
      id: row.id,
      ownerUserId: row.ownerUserId!,
      name: row.translations[0]?.label ?? '',
      parentCategoryId: row.parentCategoryId!,
      defaultType: row.defaultType as CategoryDefaultType,
      status: row.status as CustomCategoryStatus,
      replacementCategoryId: row.replacementCategoryId,
      createdAt: row.createdAt,
    });
  }

  private toCategoryReference(
    category: { id: string; code: string; status: string } | null,
  ): CategoryReference | null {
    if (!category) {
      return null;
    }
    // `status` is TEXT + CHECK IN ('active','deprecated') at the database
    // level (§13.23), not a native Prisma enum — the cast mirrors
    // transaction.mapper.ts's documented rationale for the same pattern.
    return {
      id: category.id,
      code: category.code,
      status: category.status as CategoryReference['status'],
    };
  }
}
