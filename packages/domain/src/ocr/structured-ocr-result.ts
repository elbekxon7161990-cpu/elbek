import type { DetectedLanguage } from '../ai-extraction/transaction-extraction-schema';
import type { OcrContentClassification } from '../repositories/ocr-provider.repository';

/**
 * TASK-AI-006's structured OCR result — every field grounded in a specific
 * requirement, mirroring TASK-AI-005's `StructuredTranscriptionResult`:
 * - `rawText`/`normalizedText` — the OCR output and its cleaned form
 *   (§6.16.3).
 * - `contentClassification` — FR-SCR-001.
 * - `detectedLanguage`/`ocrConfidence` — the provider's own signals, kept
 *   separate from AI extraction confidence (§6.10.3/§6.12.3, generalized).
 * - `currencyCandidates`/`merchantCandidate` — FR-INP-040/043's candidate
 *   signals (not a final decision — see `extract-candidate-signals.ts`).
 * - `imageObjectStorageUri`/`sourceType` — FR-OCR-007/FR-STT-006-style
 *   linkage; this Worker doesn't itself write a
 *   `transactions.source_reference` column (persistence is out of scope,
 *   same boundary as every other AI-* task), but carries the URI so a
 *   later persistence step has it available.
 * - `processedAt` — when this Worker completed OCR.
 */
export interface StructuredOcrResult {
  rawText: string;
  normalizedText: string;
  contentClassification: OcrContentClassification;
  detectedLanguage: DetectedLanguage | null;
  ocrConfidence: number;
  currencyCandidates: readonly string[];
  merchantCandidate: string | null;
  providerModelIdentifier: string;
  imageObjectStorageUri: string;
  sourceType: 'photo' | 'screenshot';
  processedAt: string;
}
