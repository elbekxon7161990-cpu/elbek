/** One structural problem found in an untrusted structured-output payload — enough for the caller to know what failed and where, without needing to re-derive it. */
export interface SchemaValidationIssue {
  /** e.g. `"transactions[0].amount"`, `"detectedLanguage"`. */
  path: string;
  message: string;
}

/**
 * TASK-AI-001 (NFR-AI-003, AC-AI-004) — thrown by
 * `validateStructuredExtractionOutput` for any structural violation:
 * missing required field, unknown field, invalid enum/type, or a
 * PRD-defined cross-field constraint (e.g. `counterparty` required for
 * `DEBT_*`/`TRANSFER` intents). Carries every issue found, not just the
 * first — `AC-AI-004`'s retry path benefits from a complete picture, not a
 * single fail-fast symptom.
 */
export class SchemaValidationError extends Error {
  readonly issues: readonly SchemaValidationIssue[];

  constructor(issues: SchemaValidationIssue[]) {
    super(
      `Structured AI output failed schema validation (${issues.length} issue(s)): ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
    );
    this.name = 'SchemaValidationError';
    this.issues = issues;
  }
}
