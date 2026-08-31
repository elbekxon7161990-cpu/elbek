import type { DetectedLanguage } from '../ai-extraction/transaction-extraction-schema';

/**
 * TASK-AI-005's structured transcription result — every field grounded in
 * a specific requirement, nothing added for decoration:
 * - `transcript`/`normalizedTranscript` — the raw and cleaned text (§6.16.3).
 * - `detectedLanguage` — FR-STT-003.
 * - `sttConfidence` — the provider's own signal, kept separate from AI
 *   extraction confidence (§6.12.3).
 * - `requiresConfirmation` — FR-STT-005.
 * - `durationSeconds`/`providerModelIdentifier` — processing metadata for
 *   observability (§6.21.2) and reproducibility.
 * - `audioObjectStorageUri` — FR-STT-006's audit/dispute linkage; this
 *   Worker doesn't itself write a `transactions.source_reference` column
 *   (persistence is out of scope, same boundary as TASK-AI-002/003/004),
 *   but carries the URI so whichever later step creates the transaction
 *   record has it available.
 * - `sourceType` — always `'voice'`, per BR-INP-003's requirement that
 *   source_type reflect the modality that actually produced the content.
 * - `processedAt` — when this Worker completed transcription.
 */
export interface StructuredTranscriptionResult {
  transcript: string;
  normalizedTranscript: string;
  detectedLanguage: DetectedLanguage | null;
  sttConfidence: number;
  requiresConfirmation: boolean;
  durationSeconds: number;
  providerModelIdentifier: string;
  audioObjectStorageUri: string;
  sourceType: 'voice';
  processedAt: string;
}
