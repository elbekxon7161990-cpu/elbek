import { describe, expect, it, vi } from 'vitest';
import type { TransactionCommitAdapter } from '@afa/application';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@afa/shared';
import { FakeTransactionCommitPort } from '@afa/infrastructure';

import { selectTransactionCommitPort } from './transaction-commit-provider.module';

function makeConfig(allowFake: boolean | undefined): ConfigService<EnvironmentVariables, true> {
  return { get: vi.fn().mockReturnValue(allowFake) } as unknown as ConfigService<
    EnvironmentVariables,
    true
  >;
}

describe('selectTransactionCommitPort', () => {
  it('binds the real adapter by default (ALLOW_FAKE_TRANSACTION_COMMIT unset)', () => {
    const realAdapter = {} as TransactionCommitAdapter;

    const result = selectTransactionCommitPort(makeConfig(undefined), realAdapter);

    expect(result).toBe(realAdapter);
  });

  it('binds the real adapter when ALLOW_FAKE_TRANSACTION_COMMIT is explicitly false', () => {
    const realAdapter = {} as TransactionCommitAdapter;

    const result = selectTransactionCommitPort(makeConfig(false), realAdapter);

    expect(result).toBe(realAdapter);
  });

  it('binds a FakeTransactionCommitPort when ALLOW_FAKE_TRANSACTION_COMMIT is explicitly true', () => {
    const realAdapter = {} as TransactionCommitAdapter;

    const result = selectTransactionCommitPort(makeConfig(true), realAdapter);

    expect(result).toBeInstanceOf(FakeTransactionCommitPort);
    expect(result).not.toBe(realAdapter);
  });
});
