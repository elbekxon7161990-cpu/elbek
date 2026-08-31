import type {
  Transaction,
  TransactionAuditChangedBy,
  TransactionAuditLogEntry,
  TransactionEditableFields,
} from '@afa/domain';

const EDITABLE_FIELDS = [
  'amount',
  'currency',
  'categoryId',
  'subcategoryId',
  'merchant',
  'paymentMethod',
  'transactionDate',
  'location',
  'tags',
  'description',
  'destinationAmount',
] as const satisfies readonly (keyof TransactionEditableFields)[];

function serializeFieldValue(
  value: string | number | boolean | Date | readonly string[] | null,
): string | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return JSON.stringify([...value].sort());
  }
  return String(value);
}

/**
 * FR-EXP-007 — "record every changed field", and only changed fields (an
 * edit that leaves a field untouched must not generate a no-op audit row).
 * Compares `before`/`after` across exactly `TransactionEditableFields`, the
 * same field set `Transaction.edit` accepts.
 */
export function computeTransactionFieldDiffs(
  before: Transaction,
  after: Transaction,
  changedBy: TransactionAuditChangedBy,
  changedAt: Date,
): TransactionAuditLogEntry[] {
  const entries: TransactionAuditLogEntry[] = [];

  for (const field of EDITABLE_FIELDS) {
    const oldValue = serializeFieldValue(before[field]);
    const newValue = serializeFieldValue(after[field]);
    if (oldValue !== newValue) {
      entries.push({
        transactionId: after.id,
        fieldName: field,
        oldValue,
        newValue,
        changedBy,
        changedAt,
      });
    }
  }

  return entries;
}
