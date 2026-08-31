/**
 * TASK-AI-004's "REPRODUCIBILITY" — every field this task's spec names
 * explicitly, so a report can always be traced back to exactly the
 * dataset/ground-truth/model/prompt/schema/evaluator combination that
 * produced it. A pure data type — assembling it (reading the current git
 * SHA, current prompt version, wall-clock time) is the composition root's
 * job (an I/O concern), never this domain type's own.
 */
export interface EvaluationRunMetadata {
  evaluationRunId: string;
  datasetVersion: string;
  groundTruthVersion: string;
  modelIdentifier: string;
  modelConfig: Readonly<Record<string, unknown>>;
  /** Identifies which version of the Extraction Template (`extraction-prompt-template.ts`, TASK-AI-002) produced the scored predictions. */
  promptVersion: string;
  /** Identifies which version of `STRUCTURED_EXTRACTION_JSON_SCHEMA` (TASK-AI-001) the predictions were validated against. */
  extractionSchemaVersion: string;
  /** Identifies which version of this evaluation framework itself scored the run — a metrics-definition change is itself a reproducibility-relevant fact. */
  evaluatorVersion: string;
  timestamp: string;
  thresholds: readonly number[];
  environmentMetadata: Readonly<Record<string, string>>;
}
