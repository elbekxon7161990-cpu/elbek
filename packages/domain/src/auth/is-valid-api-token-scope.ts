/**
 * TASK-AUTH-003 (§14.15.4) — `{resource}:{verb}` or `admin:{resource}:{verb}`.
 * Matches every example the PRD gives (`transactions:read`, `admin:categories:write`,
 * `ai:invoke` — note "invoke" is a verb here too, not only read/write, so this
 * deliberately does not enumerate a fixed verb list).
 */
const API_TOKEN_SCOPE_PATTERN = /^([a-z][a-z0-9_]*:){1,2}[a-z][a-z0-9_]*$/;

export function isValidApiTokenScope(scope: string): boolean {
  return API_TOKEN_SCOPE_PATTERN.test(scope);
}
