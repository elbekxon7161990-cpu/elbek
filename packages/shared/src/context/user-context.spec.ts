import { describe, expect, it } from 'vitest';

import { MissingDatabaseUserContextError } from './missing-database-user-context.error';
import { getCurrentUserId, requireCurrentUserId, runWithUserContext } from './user-context';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

describe('user-context (AsyncLocalStorage)', () => {
  it('stores and returns the user id within the running context', () => {
    runWithUserContext('user-1', () => {
      expect(getCurrentUserId()).toBe('user-1');
    });
  });

  it('keeps concurrent contexts isolated from each other', async () => {
    const seenByA: (string | undefined)[] = [];
    const seenByB: (string | undefined)[] = [];

    await Promise.all([
      runWithUserContext('user-a', async () => {
        seenByA.push(getCurrentUserId());
        await delay(20);
        seenByA.push(getCurrentUserId());
      }),
      runWithUserContext('user-b', async () => {
        seenByB.push(getCurrentUserId());
        await delay(10);
        seenByB.push(getCurrentUserId());
      }),
    ]);

    expect(seenByA).toEqual(['user-a', 'user-a']);
    expect(seenByB).toEqual(['user-b', 'user-b']);
  });

  it('throws MissingDatabaseUserContextError when no context is established', () => {
    expect(() => requireCurrentUserId()).toThrow(MissingDatabaseUserContextError);
  });

  it('returns undefined (not throwing) from getCurrentUserId outside any context', () => {
    expect(getCurrentUserId()).toBeUndefined();
  });

  it('does not leak context after runWithUserContext completes (no global residue)', () => {
    runWithUserContext('user-1', () => {
      expect(getCurrentUserId()).toBe('user-1');
    });

    expect(getCurrentUserId()).toBeUndefined();
  });

  it('preserves context across nested async operations and Promise chains', async () => {
    async function innermost(): Promise<string | undefined> {
      await delay(5);
      return getCurrentUserId();
    }
    async function middle(): Promise<string | undefined> {
      return Promise.resolve().then(() => innermost());
    }
    async function outer(): Promise<string | undefined> {
      return middle();
    }

    const result = await runWithUserContext('user-nested', () => outer());
    expect(result).toBe('user-nested');
  });

  it('rejects establishing an empty user id', () => {
    expect(() => runWithUserContext('', () => undefined)).toThrow();
  });
});
