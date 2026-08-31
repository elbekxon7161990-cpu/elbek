import type { TransactionAuditChangedBy, TransactionEditableFields } from '@afa/domain';

export interface EditTransactionInput {
  transactionId: string;
  userId: string;
  changes: Partial<TransactionEditableFields>;
  /** Audit provenance (§13.9 `changed_by`) — defaults to `'user_edit'`. */
  actor?: TransactionAuditChangedBy;
}
