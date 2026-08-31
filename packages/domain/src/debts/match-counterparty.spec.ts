import { describe, expect, it } from 'vitest';

import { Counterparty } from '../entities/counterparty.entity';
import { matchCounterparty } from './match-counterparty';

const FIXED_NOW = new Date('2026-08-13T12:00:00Z');

function makeCounterparty(id: string, name: string, aliases: string[] = []): Counterparty {
  return new Counterparty({ id, userId: 'user-1', name, aliases, createdAt: FIXED_NOW });
}

describe('matchCounterparty', () => {
  it('resolves an exact match (case/whitespace-insensitive)', () => {
    const aziz = makeCounterparty('c-1', 'Aziz');
    const result = matchCounterparty('  aziz  ', [aziz]);
    expect(result).toEqual({ outcome: 'exact', counterparty: aziz });
  });

  it('resolves an exact match against an alias', () => {
    const aziz = makeCounterparty('c-1', 'Aziz Karimov', ['Azizbek']);
    const result = matchCounterparty('azizbek', [aziz]);
    expect(result).toEqual({ outcome: 'exact', counterparty: aziz });
  });

  it('returns "new" when there is no existing counterparty at all', () => {
    expect(matchCounterparty('Aziz', [])).toEqual({ outcome: 'new' });
  });

  it('returns "new" when no existing name is even a plausible fuzzy match', () => {
    const dilnoza = makeCounterparty('c-1', 'Dilnoza');
    expect(matchCounterparty('Aziz', [dilnoza])).toEqual({ outcome: 'new' });
  });

  it('returns "ambiguous" for a single plausible fuzzy (non-exact) match — never silently auto-resolved (FR-DBT-008)', () => {
    const aziz = makeCounterparty('c-1', 'Aziz');
    const result = matchCounterparty('Azis', [aziz]); // one-character typo
    expect(result.outcome).toBe('ambiguous');
    if (result.outcome === 'ambiguous') {
      expect(result.candidates).toEqual([aziz]);
    }
  });

  it('returns "ambiguous" with all plausible candidates when multiple similar names exist', () => {
    const aziz1 = makeCounterparty('c-1', 'Aziz Karimov');
    const aziz2 = makeCounterparty('c-2', 'Aziz Yusupov');
    const result = matchCounterparty('Aziz', [aziz1, aziz2]);
    expect(result.outcome).toBe('ambiguous');
    if (result.outcome === 'ambiguous') {
      expect(result.candidates).toHaveLength(2);
    }
  });

  it('never mixes in an unrelated counterparty as a fuzzy candidate', () => {
    const aziz = makeCounterparty('c-1', 'Aziz');
    const dilnoza = makeCounterparty('c-2', 'Dilnoza');
    const result = matchCounterparty('Azis', [aziz, dilnoza]);
    expect(result.outcome).toBe('ambiguous');
    if (result.outcome === 'ambiguous') {
      expect(result.candidates.map((c) => c.id)).toEqual(['c-1']);
    }
  });
});
