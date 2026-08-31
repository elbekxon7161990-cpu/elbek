import { applyFieldConfidenceGating } from './apply-field-confidence-gating';
import { classifyRecordConfidence, computeRecordConfidence } from './compute-record-confidence';
import { evaluateFieldGrounding } from './evaluate-field-grounding';
import { applySanityBounds } from './evaluate-sanity-bounds';
import type { RecordConfidenceClassification } from './compute-record-confidence';
import type {
  StructuredExtractionOutput,
  TransactionExtractionCandidate,
} from './transaction-extraction-schema';

/**
 * TASK-AI-003 (Chapter 4 §4.8; MVP Launch Checklist §20.2: "Hallucination-
 * prevention layers (prompt, schema, grounding, confidence-gating, sanity
 * bounds, audit trail) are all implemented, not a subset") — composes the
 * layers this task owns (grounding, per-field confidence gating, sanity
 * bounds, record-confidence classification) into one pass over an
 * already schema-validated, already intent-gated
 * `StructuredExtractionOutput` (TASK-AI-001/TASK-AI-002's output).
 *
 * The prompt-level layer (§4.8 layer 1) and schema-level layer (layer 2)
 * are already implemented — TASK-AI-002's system prompt and TASK-AI-001's
 * strict validator, respectively — and are not reimplemented here.
 *
 * Per-candidate results form this pass's audit trail (§4.8 layer 6's
 * "traceable" requirement, operationalized here as an inspectable,
 * returned report rather than a silent mutation) — every field a layer
 * altered is named, together with the record's final confidence
 * classification, so a caller can log/persist/expose this for QA spot-
 * checking (§4.8 layer 3's own stated purpose) without this task reaching
 * into Prisma/the audit_log table itself (out of scope, no DB access).
 */
export interface CandidateGuardrailReport {
  /** Fields nulled because they had no textual support in the input (FR-AI-024/BR-AI-002). */
  groundingFlags: readonly string[];
  /** Fields nulled because their reported confidence was Low (§4.6.1, < 0.6). */
  confidenceGateFlags: readonly string[];
  /** Fields nulled because they fell outside a plausibility bound (§4.8 layer 5). */
  sanityBoundFlags: readonly string[];
  /** §4.6.2 — minimum of required-field confidences for this candidate, after all filtering above. */
  recordConfidence: number;
  /** §4.6.2's three-way outcome. */
  classification: RecordConfidenceClassification;
}

export interface HallucinationPreventionResult {
  output: StructuredExtractionOutput;
  /** One report per `output.transactions[i]`, same order — the audit trail. */
  candidateReports: readonly CandidateGuardrailReport[];
}

function processCandidate(
  candidate: TransactionExtractionCandidate,
  inputText: string,
  currentDateTime: string,
): { candidate: TransactionExtractionCandidate; report: CandidateGuardrailReport } {
  const grounded = evaluateFieldGrounding(candidate, inputText);
  const gated = applyFieldConfidenceGating(grounded.candidate);
  const bounded = applySanityBounds(gated.candidate, currentDateTime);

  const recordConfidence = computeRecordConfidence(bounded.candidate);
  const classification = classifyRecordConfidence(recordConfidence);

  return {
    candidate: bounded.candidate,
    report: {
      groundingFlags: grounded.ungroundedFields,
      confidenceGateFlags: gated.gatedFields,
      sanityBoundFlags: bounded.flaggedFields,
      recordConfidence,
      classification,
    },
  };
}

export function applyHallucinationPreventionLayers(
  output: StructuredExtractionOutput,
  inputText: string,
  currentDateTime: string,
): HallucinationPreventionResult {
  const processed = output.transactions.map((candidate) =>
    processCandidate(candidate, inputText, currentDateTime),
  );

  const anyFlagged = processed.some(
    ({ report }) =>
      report.classification !== 'auto_commit' ||
      report.groundingFlags.length > 0 ||
      report.confidenceGateFlags.length > 0 ||
      report.sanityBoundFlags.length > 0,
  );

  const clarificationNeeded = output.clarificationNeeded || anyFlagged;

  return {
    output: {
      ...output,
      transactions: processed.map((p) => p.candidate),
      clarificationNeeded,
      clarificationQuestion:
        clarificationNeeded && !output.clarificationQuestion
          ? "I'm not fully confident about part of this — could you double-check it?"
          : output.clarificationQuestion,
    },
    candidateReports: processed.map((p) => p.report),
  };
}
