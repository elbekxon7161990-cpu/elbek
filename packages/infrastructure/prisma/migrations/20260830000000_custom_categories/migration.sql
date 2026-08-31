-- ============================================================================
-- TASK-FIN-006 — Custom Categories (Additive)
-- ============================================================================
-- `categories.owner_user_id`/`parent_category_id`/`status`/
-- `replacement_category_id` already exist (init migration) but are unused by
-- any application code today — no column change needed for the core
-- feature. This migration adds only what genuinely does not exist yet:
--
-- 1. `category_translations.owner_user_id` — denormalized from
--    `categories.owner_user_id` (NULL for every system-category translation
--    row, set for a custom category's own single translation row). This is
--    the real DB-level duplicate-create guard FR-SET-003/BR-FIN-005 need:
--    a partial unique index scoped to a user's own rows, which nothing on
--    `categories` itself could express (the display name lives in
--    `category_translations`, keyed by `category_id`+`language`, not by
--    owner).
-- 2. Two supporting indexes (`categories` had none beyond the implicit
--    unique index on `code`).
-- 3. Row-Level Security on `categories`/`category_translations` — neither
--    table has ever had a policy (verified against the init migration's own
--    `ENABLE ROW LEVEL SECURITY` section and
--    `rls-protected-models.ts`'s own explicit "deliberately NOT included"
--    list). Now that `categories` genuinely holds per-user-owned rows, this
--    closes that gap — application-layer ownership checks
--    (`findCustomCategoryById(id, ownerUserId)`) and this DB policy are
--    deliberately redundant, defense-in-depth, per this task's own
--    instruction that RLS and application authorization complement each
--    other. The policy shape is NOT the standard `tenant_isolation` one
--    (`user_id = current_setting(...)`) used everywhere else — it cannot be,
--    since a `NULL` `owner_user_id` (every system category) must stay
--    visible to every user, not just its "owner". `app_user` may only ever
--    INSERT/UPDATE/DELETE its own rows (`owner_user_id = current_setting(...)`);
--    it may never touch a system row (`owner_user_id IS NULL`) — deprecating
--    a *system* category stays an Admin-Panel-only, `app_admin`
--    (`BYPASSRLS`) operation, untouched by this migration.
-- ============================================================================

ALTER TABLE category_translations
    ADD COLUMN owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX ux_category_translations_owner_lang_label
    ON category_translations (owner_user_id, language, lower(label))
    WHERE owner_user_id IS NOT NULL;

CREATE INDEX idx_categories_owner_status
    ON categories (owner_user_id, status);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY category_visibility ON categories
    FOR SELECT USING (
        owner_user_id IS NULL
        OR owner_user_id = current_setting('app.current_user_id', true)::uuid
    );

CREATE POLICY category_owner_insert ON categories
    FOR INSERT WITH CHECK (owner_user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY category_owner_update ON categories
    FOR UPDATE
    USING (owner_user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (owner_user_id = current_setting('app.current_user_id', true)::uuid);

ALTER TABLE category_translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY category_translation_visibility ON category_translations
    FOR SELECT USING (
        owner_user_id IS NULL
        OR owner_user_id = current_setting('app.current_user_id', true)::uuid
    );

CREATE POLICY category_translation_owner_insert ON category_translations
    FOR INSERT WITH CHECK (owner_user_id = current_setting('app.current_user_id', true)::uuid);

-- ============================================================================
-- End of migration.
-- ============================================================================
