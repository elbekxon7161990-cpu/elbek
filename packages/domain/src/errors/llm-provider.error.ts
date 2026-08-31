/**
 * TASK-INFRA-010 (FR-SYS-006) — base for every provider-neutral error this
 * port's implementations may throw. Vendor-specific error types/details
 * (an Anthropic/OpenAI SDK exception, an HTTP status body) are translated
 * into one of this hierarchy's subclasses at the infrastructure boundary —
 * they never propagate past the adapter into application/domain code.
 *
 * Deliberately, no subclass constructor accepts a raw request payload, API
 * key, or provider response body — only a plain `message` string the
 * implementer writes by hand. This is a structural guarantee against
 * secret/PII leakage into an error's `.message`/`.stack` (Chapter 16 §16.3
 * data minimization; this port's own file header), not a runtime redaction
 * step that could be forgotten.
 */
export abstract class LlmProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
