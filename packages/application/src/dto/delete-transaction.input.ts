import type { TransactionAuditChangedBy } from '@afa/domain';

export interface DeleteTransactionInput {
  transactionId: string;
  userId: string;
  /** Audit provenance (§13.9 `changed_by`) — defaults to `'user_edit'`. */
  actor?: TransactionAuditChangedBy;
}
