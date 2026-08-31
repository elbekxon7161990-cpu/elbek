import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransactionCommitAdapter, TransactionCommitModule } from '@afa/application';
import { TRANSACTION_COMMIT_PORT } from '@afa/domain';
import type { TransactionCommitPort } from '@afa/domain';
import { FakeTransactionCommitPort } from '@afa/infrastructure';
import type { EnvironmentVariables } from '@afa/shared';

const logger = new Logger('TransactionCommitProviderModule');

/** Exported for direct unit testing without standing up a full Nest DI container. */
export function selectTransactionCommitPort(
  config: ConfigService<EnvironmentVariables, true>,
  realAdapter: TransactionCommitAdapter,
): TransactionCommitPort {
  const allowFake = config.get('ALLOW_FAKE_TRANSACTION_COMMIT', { infer: true });
  if (allowFake) {
    logger.warn(
      'ALLOW_FAKE_TRANSACTION_COMMIT=true — binding a FAKE TransactionCommitPort. No real transaction will be persisted. This must never be true in a production deployment.',
    );
    return new FakeTransactionCommitPort();
  }
  return realAdapter;
}

/**
 * TASK-FIN-REAL-001 — the composition root for `TRANSACTION_COMMIT_PORT`,
 * mirroring `LlmProviderModule`'s real-vs-fake split (TASK-INFRA-AI-REAL-001).
 * Binds the real, Prisma-backed `TransactionCommitAdapter` by default;
 * `ALLOW_FAKE_TRANSACTION_COMMIT=true` explicitly opts into
 * `FakeTransactionCommitPort` instead (never the default — see that env
 * var's own doc comment in `EnvironmentVariables` for why this is an
 * explicit opt-in, not a fail-fast gate like the LLM provider's).
 *
 * `@Global()` (TASK-MVP-002) — see @afa/infrastructure's
 * user-repository.module.ts for why a sibling import under a shared
 * parent module does not make `TRANSACTION_COMMIT_PORT` visible to
 * whichever module needs it (`ProcessConversationEventUseCase`).
 */
@Global()
@Module({
  imports: [TransactionCommitModule],
  providers: [
    {
      provide: TRANSACTION_COMMIT_PORT,
      useFactory: selectTransactionCommitPort,
      inject: [ConfigService, TransactionCommitAdapter],
    },
  ],
  exports: [TRANSACTION_COMMIT_PORT],
})
export class TransactionCommitProviderModule {}
