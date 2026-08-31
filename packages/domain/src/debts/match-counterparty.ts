import type { Counterparty } from '../entities/counterparty.entity';

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Classic Levenshtein edit distance — no external dependency, intentionally simple (§8.3's own scope is "fuzzy matching", not a specific algorithm). */
function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) matrix[i]![0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0]![j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }
  return matrix[rows - 1]![cols - 1]!;
}

/**
 * FR-DBT-008 — distance threshold scales with name length so a small typo
 * in a long name isn't over-penalized, while the same absolute distance in
 * a short name still counts as "plausibly a different person". A fixed
 * absolute threshold would be too strict for long names and too loose for
 * short ones.
 */
function isPlausibleFuzzyMatch(normalizedQuery: string, normalizedCandidate: string): boolean {
  if (normalizedQuery === normalizedCandidate) {
    return false; // exact matches are handled separately by the caller
  }
  // Word-prefix containment (e.g. "Aziz" against a stored "Aziz Karimov")
  // is at least as plausible a match as a small-edit-distance typo — a
  // common real-world case (users often refer to someone by first name
  // only), and one plain Levenshtein distance handles poorly (a short
  // query against a much longer full name has a large edit distance even
  // when it is obviously the same person's first name).
  if (
    normalizedCandidate.startsWith(`${normalizedQuery} `) ||
    normalizedQuery.startsWith(`${normalizedCandidate} `)
  ) {
    return true;
  }
  const distance = levenshteinDistance(normalizedQuery, normalizedCandidate);
  const threshold = Math.max(
    1,
    Math.floor(Math.min(normalizedQuery.length, normalizedCandidate.length) / 4),
  );
  return distance <= threshold;
}

export type CounterpartyMatchResult =
  | { outcome: 'exact'; counterparty: Counterparty }
  | { outcome: 'new' }
  | { outcome: 'ambiguous'; candidates: readonly Counterparty[] };

/**
 * TASK-FIN-002 (FR-DBT-008) — "exact match first; normalized comparison;
 * fuzzy candidates only when appropriate; if multiple plausible
 * counterparties exist, use the existing clarification mechanism; never
 * silently choose an ambiguous counterparty."
 *
 * A *single* fuzzy (non-exact) candidate is still reported as `'ambiguous'`,
 * not auto-resolved — per §8.3's own error-handling table ("two people with
 * similar names -> clarification with both candidates plus a 'someone
 * else' fallback"), a fuzzy match on its own is never confident enough to
 * silently resolve, because the query name could also plausibly be a new
 * person the fuzzy candidate merely happens to resemble.
 *
 * Caller contract (BR-DBT-002): `existingCounterparties` must already be
 * scoped to one user's own counterparties — this function has no user
 * concept of its own and performs no isolation itself.
 */
export function matchCounterparty(
  queryName: string,
  existingCounterparties: readonly Counterparty[],
): CounterpartyMatchResult {
  const normalizedQuery = normalizeName(queryName);

  const exactMatches = existingCounterparties.filter(
    (counterparty) =>
      normalizeName(counterparty.name) === normalizedQuery ||
      counterparty.aliases.some((alias) => normalizeName(alias) === normalizedQuery),
  );
  if (exactMatches.length === 1) {
    return { outcome: 'exact', counterparty: exactMatches[0]! };
  }
  if (exactMatches.length > 1) {
    // A data anomaly (two records sharing the same normalized name/alias),
    // not the common case — still surfaced as ambiguous rather than
    // silently picking one (never silently choose).
    return { outcome: 'ambiguous', candidates: exactMatches };
  }

  const fuzzyCandidates = existingCounterparties.filter(
    (counterparty) =>
      isPlausibleFuzzyMatch(normalizedQuery, normalizeName(counterparty.name)) ||
      counterparty.aliases.some((alias) =>
        isPlausibleFuzzyMatch(normalizedQuery, normalizeName(alias)),
      ),
  );
  if (fuzzyCandidates.length === 0) {
    return { outcome: 'new' };
  }
  return { outcome: 'ambiguous', candidates: fuzzyCandidates };
}
