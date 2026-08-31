/**
 * TASK-AI-005 — the BullMQ job payload shape (Chapter 3 §3.3.3 Job Queue &
 * Worker Pool). By the time this job exists, the Bot Application Layer has
 * already uploaded the raw audio to Object Storage and enqueued the job
 * (§6.12.2's sequence diagram) — that upload/enqueue step belongs to a
 * different, not-yet-built task (the Bot App Layer), not this Worker.
 *
 * `telegramFileId` is Telegram's own stable identifier for the voice
 * message; enqueuing code (out of this task's scope) is expected to derive
 * the BullMQ `jobId` from it (or from Telegram's `file_unique_id`) so that
 * re-delivery of the same Telegram update is a BullMQ no-op rather than a
 * duplicate job — this type carries the field a future enqueuer needs for
 * that, but does not itself perform the enqueue.
 */
export interface VoiceTranscriptionJobPayload {
  jobId: string;
  userId: string;
  telegramFileId: string;
  audioObjectStorageUri: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
  /** §4.5.3's `current_datetime` — needed downstream by the AI extraction pipeline (TASK-AI-002) for relative-date resolution. */
  currentDateTime: string;
  userDefaultCurrency: string;
  userRecentCategories: readonly string[];
}
