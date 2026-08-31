import type { PaymentMethod } from '../../entities/transaction.entity';
import type { AiIntent, DetectedLanguage } from '../transaction-extraction-schema';

/**
 * TASK-AI-004 (Chapter 4 §4.27.2 "Ground truth source: Human-labeled, not
 * model-labeled — an evaluation framework that scores a model against its
 * own outputs measures nothing").
 *
 * Deliberately a *separate* type from `TransactionExtractionCandidate`
 * (the model's prediction shape, TASK-AI-001) even though the field names
 * mirror it — mixing "what a human confirmed is true" with "what the model
 * claimed" in one type would blur exactly the RAW INPUT / GROUND TRUTH /
 * MODEL PREDICTION / EVALUATION RESULT separation this task requires.
 * Ground truth has no confidence scores — a human annotation is either
 * asserted or it isn't.
 *
 * `null` here means "the annotator confirmed this field is genuinely
 * absent" (e.g. no merchant was named) — evaluation code must treat a
 * correctly-predicted null as correct, never as an automatic miss.
 */
export interface GroundTruthCandidate {
  intent: AiIntent;
  amount: number | null;
  currency: string | null;
  category: string | null;
  subcategory: string | null;
  merchant: string | null;
  paymentMethod: PaymentMethod | null;
  transactionDate: string | null;
  transactionTime: string | null;
  location: string | null;
  counterparty: string | null;
  dueDate: string | null;
  description: string;
}

export type AnnotationStatus = 'pending' | 'reviewed' | 'disputed' | 'adjudicated';

/**
 * §4.27.2's human-labeling requirement plus this task's own "disagreement
 * handling / adjudication / immutable ground-truth snapshots" requirement.
 * `secondReviewerGroundTruth`/`adjudicatedGroundTruth` are populated only
 * when two annotators disagreed and a third (adjudicator) resolved it —
 * left `null` for the common single-reviewer-agrees case.
 */
export interface AnnotationMetadata {
  status: AnnotationStatus;
  reviewer: string;
  /** Independently incremented whenever this item's ground truth is re-annotated — never mutated in place, always a new version. */
  annotationVersion: number;
  secondReviewer: string | null;
  adjudicator: string | null;
  annotatedAt: string;
}

export type DatasetSourceType = 'text' | 'voice' | 'photo' | 'pdf' | 'excel' | 'csv' | 'screenshot';

/**
 * One held-out benchmark example (§4.27.2). `datasetVersion` is set once
 * per dataset snapshot (every item sharing a snapshot shares the same
 * value) — an evaluation run records which `datasetVersion` it used
 * (`EvaluationRunMetadata`) so a report is always reproducible against the
 * exact set of items that produced it.
 */
export interface EvaluationDatasetItem {
  id: string;
  datasetVersion: string;
  rawInputText: string;
  inputLanguage: DetectedLanguage;
  sourceType: DatasetSourceType;
  groundTruth: GroundTruthCandidate;
  annotation: AnnotationMetadata;
  createdAt: string;
}

export interface DatasetIssue {
  itemId: string;
  message: string;
}

export interface DatasetValidationResult {
  validItems: readonly EvaluationDatasetItem[];
  issues: readonly DatasetIssue[];
}

/**
 * Fail-closed, issue-collecting validation (same discipline as TASK-AI-001's
 * `validateStructuredExtractionOutput`) — a malformed dataset entry is
 * excluded from scoring and reported, never silently scored as if valid,
 * and never allowed to crash an entire evaluation run over one bad row.
 */
export function validateEvaluationDataset(
  items: readonly EvaluationDatasetItem[],
): DatasetValidationResult {
  const issues: DatasetIssue[] = [];
  const seenIds = new Set<string>();
  const validItems: EvaluationDatasetItem[] = [];

  for (const item of items) {
    if (!item.id || typeof item.id !== 'string') {
      issues.push({
        itemId: String(item.id ?? '<missing>'),
        message: 'Dataset item is missing a stable string id.',
      });
      continue;
    }
    if (seenIds.has(item.id)) {
      issues.push({ itemId: item.id, message: `Duplicate dataset item id "${item.id}".` });
      continue;
    }
    if (!item.rawInputText || item.rawInputText.trim().length === 0) {
      issues.push({ itemId: item.id, message: 'Dataset item is missing rawInputText.' });
      continue;
    }
    if (!item.groundTruth) {
      issues.push({ itemId: item.id, message: 'Dataset item is missing groundTruth.' });
      continue;
    }
    if (!item.annotation || item.annotation.status === 'pending') {
      issues.push({
        itemId: item.id,
        message:
          'Dataset item has no reviewed/adjudicated annotation — cannot be used as ground truth.',
      });
      continue;
    }

    seenIds.add(item.id);
    validItems.push(item);
  }

  return { validItems, issues };
}
