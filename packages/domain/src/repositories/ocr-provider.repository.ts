import type { Buffer } from 'node:buffer';
import type { DetectedLanguage } from '../ai-extraction/transaction-extraction-schema';

/** DI token for @afa/infrastructure's implementation — no concrete provider bound yet, mirroring `STT_PROVIDER`/`LLM_PROVIDER`'s split. */
export const OCR_PROVIDER = Symbol('OCR_PROVIDER');

export type OcrContentClassification = 'receipt' | 'screenshot' | 'invoice' | 'unknown';

/**
 * TASK-AI-006 (Chapter 6 §6.3/§6.13, FR-SYS-006/FR-INT-001's Shared
 * Adapter Pattern) — the provider-neutral request/response contract for
 * OCR, structurally parallel to TASK-AI-005's `SttTranscriptionRequest`/
 * `SttProvider` but for a distinct provider category.
 *
 * `contentHint` lets the caller (this task's own use case, informed by
 * which Telegram upload flow produced the image) suggest a layout-aware
 * (receipt/invoice) vs. layout-blind (screenshot) extraction profile per
 * §6.13.3/ADR-INP-003 — the provider decides how to act on it; this port
 * does not itself implement image-content classification (no real vision
 * model is bound in this environment; see this task's final report).
 */
export interface OcrExtractionRequest {
  image: Buffer;
  mimeType: string;
  contentHint?: OcrContentClassification;
  languageHints?: readonly DetectedLanguage[];
}

/**
 * `confidence` is the provider's own reported signal — kept separate from
 * the AI Processing Core's own extraction confidence, generalizing the
 * same "Confidence Signal Separation" principle §6.12.3/§6.10.3 state for
 * "Any provider" (not STT-specific): "Raw Extraction Result... always
 * including provider confidence even when it is low."
 *
 * `contentClassification` is the provider's own best-effort answer to
 * FR-SCR-001 ("recognize when an uploaded photo is a digital screenshot
 * rather than a photographed physical receipt") — see the port doc
 * comment above for why this lives in the provider's response rather
 * than a separate classifier component.
 */
export interface OcrExtractionResult {
  rawText: string;
  contentClassification: OcrContentClassification;
  detectedLanguage: DetectedLanguage | null;
  confidence: number;
  providerModelIdentifier: string;
  processingDurationMs: number;
}

/**
 * Port (Chapter 3 §3.16.1). Implemented by packages/infrastructure;
 * @afa/application depends only on this interface, never on a vendor OCR
 * SDK.
 */
export interface OcrProvider {
  extractText(request: OcrExtractionRequest): Promise<OcrExtractionResult>;
}
