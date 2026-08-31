import type { VoiceTranscriptionJobPayload } from '../stt/voice-transcription-job';

export const VOICE_TRANSCRIPTION_QUEUE = Symbol('VOICE_TRANSCRIPTION_QUEUE');

/**
 * TASK-BOT-001 — the producer-side counterpart to TASK-AI-005's
 * `stt-transcription` BullMQ queue. `@afa/application` must never import
 * `bullmq` directly (its own package.json's boundary rule), so enqueuing a
 * job is expressed as a port here, implemented in `@afa/infrastructure`
 * against the already-registered `STT_TRANSCRIPTION_QUEUE_NAME` queue
 * (`SttTranscriptionQueueModule`, TASK-AI-005) — the same queue
 * `apps/worker`'s (not-yet-wired) `SttTranscriptionProcessor` consumes.
 */
export interface VoiceTranscriptionQueuePort {
  enqueue(payload: VoiceTranscriptionJobPayload): Promise<void>;
}
