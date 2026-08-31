import type { Buffer } from 'node:buffer';
import type { DetectedLanguage } from '../ai-extraction/transaction-extraction-schema';

/** DI token for @afa/infrastructure's implementation — no concrete provider bound yet, mirroring `LLM_PROVIDER`'s split (TASK-INFRA-010). */
export const STT_PROVIDER = Symbol('STT_PROVIDER');

/**
 * TASK-AI-005 (Chapter 6 §6.2, FR-SYS-006/FR-INT-001's Shared Adapter
 * Pattern) — the provider-neutral request/response contract for Speech-to-
 * Text, structurally parallel to TASK-INFRA-010's `LlmCompletionRequest`/
 * `LlmProvider` but for a genuinely different provider category (Chapter 3
 * §3.16.1 lists STT as its own adapter boundary, not a variant of the LLM
 * one).
 *
 * `audio` is a `Buffer`, never a filesystem path — this port never assumes
 * or requires local disk staging, so there is no temporary audio file for
 * any implementation to remember to clean up (§6's "never leave
 * unnecessary temporary audio files behind").
 */
export interface SttTranscriptionRequest {
  audio: Buffer;
  mimeType: string;
  /** FR-STT-003 — auto-detection is required, so hints are optional, never a mandatory single-language selection. */
  languageHints?: readonly DetectedLanguage[];
}

/**
 * `confidence` is the provider's own reported signal — never merged with
 * or substituted for the AI Processing Core's own extraction confidence
 * (§6.12.3's "Confidence Signal Separation": these are distinct, both-
 * retained signals, never conflated at this boundary).
 */
export interface SttTranscriptionResult {
  transcript: string;
  detectedLanguage: DetectedLanguage | null;
  confidence: number;
  durationSeconds: number;
  providerModelIdentifier: string;
}

/**
 * Port (Chapter 3 §3.16.1). Implemented by packages/infrastructure;
 * @afa/application depends only on this interface, never on a vendor STT
 * SDK.
 */
export interface SttProvider {
  transcribe(request: SttTranscriptionRequest): Promise<SttTranscriptionResult>;
}
