/**
 * TASK-AI-005 (Chapter 6 §6.2, `FR-STT-*`) — the STT analog of TASK-INFRA-010's
 * `LlmProviderError` hierarchy. A separate class hierarchy, not a reused one,
 * because Speech-to-Text is its own External Provider category distinct from
 * the LLM provider (Chapter 3 §3.16.1's Shared Adapter Pattern table lists
 * "LLM, STT, OCR, FX Rate API" as separate adapter boundaries) — but the
 * *shape* of this hierarchy (six categories, no raw payload/secret in the
 * message) is deliberately identical, not reinvented, so error handling
 * stays consistent across every provider adapter in the system.
 */
export abstract class SttProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
