import type {
  TransactionCommitPort,
  TransactionCommitRequest,
  TransactionCommitResult,
} from '@afa/domain';

/**
 * A deterministic, in-memory `TransactionCommitPort` test double — never
 * wired into any production DI module. `TransactionCommitPort`'s own doc
 * comment explains why no real adapter exists yet (the undocumented
 * category-code-to-UUID resolution gap discovered while building this
 * task); this fake exists so callers of `ProcessConversationEventUseCase`
 * outside `@afa/application`'s own test suite (e.g. a future worker/bot
 * composition root's tests) have a shared, deterministic double rather than
 * each writing their own.
 */
export class FakeTransactionCommitPort implements TransactionCommitPort {
  readonly calls: TransactionCommitRequest[] = [];
  private nextId = 1;

  async commit(request: TransactionCommitRequest): Promise<TransactionCommitResult> {
    this.calls.push(request);
    const transactionId = `fake-txn-${this.nextId}`;
    this.nextId += 1;
    return { transactionId };
  }
}
