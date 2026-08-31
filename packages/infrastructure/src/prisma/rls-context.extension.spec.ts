import { MissingDatabaseUserContextError, runWithUserContext } from '@afa/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRlsQueryHandler } from './rls-context.extension';

describe('createRlsQueryHandler', () => {
  let basePrisma: { $transaction: ReturnType<typeof vi.fn>; $executeRaw: ReturnType<typeof vi.fn> };
  let query: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // $transaction([a, b]) resolves to [resultOfA, resultOfB] — mirror that
    // shape so the handler's destructuring (`const [, result] = ...`) behaves
    // the same as it would against real Prisma.
    basePrisma = {
      $executeRaw: vi.fn().mockReturnValue('SET_CONFIG_STATEMENT'),
      $transaction: vi.fn().mockImplementation(async (ops: unknown[]) => {
        const results = await Promise.all(
          ops.map((op) => (op === 'SET_CONFIG_STATEMENT' ? undefined : op)),
        );
        return results;
      }),
    };
    query = vi.fn().mockResolvedValue({ id: 'row-1' });
  });

  it('reads the current ALS user id and executes set_config before the query, for an RLS-protected model', async () => {
    const handler = createRlsQueryHandler(basePrisma);

    const result = await runWithUserContext('user-1', () =>
      handler({ model: 'Transaction', args: { where: { id: 'txn-1' } }, query }),
    );

    expect(result).toEqual({ id: 'row-1' });
    expect(query).toHaveBeenCalledWith({ where: { id: 'txn-1' } });
    expect(basePrisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(basePrisma.$transaction).toHaveBeenCalledTimes(1);

    // Order: set_config statement is element 0, the query is element 1 —
    // array-form $transaction executes its elements sequentially, so this
    // ordering is what makes set_config visible to the query that follows.
    const [batch] = basePrisma.$transaction.mock.calls[0] as [unknown[]];
    expect(batch[0]).toBe('SET_CONFIG_STATEMENT');
    expect(batch[1]).toBeInstanceOf(Promise);
  });

  it('uses is_local=true in the set_config call (never plain SET / is_local=false)', async () => {
    const handler = createRlsQueryHandler(basePrisma);

    await runWithUserContext('user-1', () => handler({ model: 'Transaction', args: {}, query }));

    const templateStrings = basePrisma.$executeRaw.mock.calls[0]?.[0] as unknown as string[];
    const fullText = templateStrings.join('${userId}');
    expect(fullText).toContain('set_config');
    expect(fullText).toContain('true');
    expect(fullText).not.toContain('false');
    expect(fullText.toUpperCase()).not.toMatch(/^SET\s+APP\./);
  });

  it('parameterizes the user id rather than interpolating it into the SQL text', async () => {
    const handler = createRlsQueryHandler(basePrisma);

    await runWithUserContext("user-1'; DROP TABLE transactions; --", () =>
      handler({ model: 'Transaction', args: {}, query }),
    );

    const [strings, ...values] = basePrisma.$executeRaw.mock.calls[0] as [
      readonly string[],
      ...unknown[],
    ];
    // The malicious value must appear only as a bound parameter, never
    // concatenated into any of the raw SQL text segments.
    for (const segment of strings) {
      expect(segment).not.toContain('DROP TABLE');
    }
    expect(values).toContain("user-1'; DROP TABLE transactions; --");
  });

  it('throws MissingDatabaseUserContextError before running any query when context is absent', async () => {
    const handler = createRlsQueryHandler(basePrisma);

    await expect(handler({ model: 'Transaction', args: {}, query })).rejects.toThrow(
      MissingDatabaseUserContextError,
    );

    expect(query).not.toHaveBeenCalled();
    expect(basePrisma.$transaction).not.toHaveBeenCalled();
    expect(basePrisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('passes a non-RLS model straight through, with no set_config/transaction wrapping', async () => {
    const handler = createRlsQueryHandler(basePrisma);

    const result = await handler({ model: 'Currency', args: { where: { code: 'UZS' } }, query });

    expect(result).toEqual({ id: 'row-1' });
    expect(query).toHaveBeenCalledWith({ where: { code: 'UZS' } });
    expect(basePrisma.$transaction).not.toHaveBeenCalled();
    expect(basePrisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('passes a raw/undefined model straight through unmodified', async () => {
    const handler = createRlsQueryHandler(basePrisma);

    await handler({ model: undefined, args: {}, query });

    expect(query).toHaveBeenCalled();
    expect(basePrisma.$transaction).not.toHaveBeenCalled();
  });

  it('always issues set_config/query through the exact base client instance it was constructed with', async () => {
    const otherBase = {
      $executeRaw: vi.fn().mockReturnValue('OTHER'),
      $transaction: vi.fn().mockResolvedValue([undefined, { id: 'row-1' }]),
    };
    const handler = createRlsQueryHandler(otherBase);

    await runWithUserContext('user-1', () => handler({ model: 'Transaction', args: {}, query }));

    expect(otherBase.$transaction).toHaveBeenCalledTimes(1);
    expect(otherBase.$executeRaw).toHaveBeenCalledTimes(1);
    expect(basePrisma.$transaction).not.toHaveBeenCalled();
    expect(basePrisma.$executeRaw).not.toHaveBeenCalled();
  });
});
