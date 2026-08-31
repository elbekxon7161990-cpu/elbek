/**
 * TASK-AI-006 (Chapter 6 §6.3, §6.13) — the OCR analog of TASK-AI-005's
 * `SttProviderError` hierarchy (itself modeled on TASK-INFRA-010's
 * `LlmProviderError`). A separate class hierarchy, not a reused one — OCR
 * is its own External Provider category (Chapter 3 §3.16.1's Shared
 * Adapter Pattern table: "LLM, STT, OCR, FX Rate API") — but the *shape*
 * (six categories, no raw payload/secret in the message) is deliberately
 * identical across all three, not reinvented per provider.
 */
export abstract class OcrProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
