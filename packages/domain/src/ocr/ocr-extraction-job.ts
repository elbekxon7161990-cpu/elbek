/**
 * TASK-AI-006 — the BullMQ job payload shape (Chapter 3 §3.3.3), mirroring
 * TASK-AI-005's `VoiceTranscriptionJobPayload`. By the time this job
 * exists, the raw image has already been uploaded to Object Storage and
 * this job enqueued by the Bot Application Layer (§6.13.2's sequence
 * diagram: `BOT->>OS: upload raw image`, before the job is even enqueued)
 * — a different, not-yet-built task, not this Worker's.
 *
 * `sourceType` distinguishes a photographed receipt from a screenshot
 * (BR-INP-003 — "source_type must always reflect the modality that
 * actually produced the raw content... since downstream observability
 * depends on this distinction"), carried through from whichever Telegram
 * upload flow produced the image (a receipt-photo flow vs. a screenshot
 * flow) rather than inferred by this Worker itself.
 *
 * `caption`, if the user sent one alongside the photo, is combined with
 * the OCR text per §6.13.4 (explicit user-stated context takes precedence
 * over OCR-inferred content).
 */
export interface OcrExtractionJobPayload {
  jobId: string;
  userId: string;
  telegramFileId: string;
  imageObjectStorageUri: string;
  mimeType: string;
  sizeBytes: number;
  sourceType: 'photo' | 'screenshot';
  caption: string | null;
  currentDateTime: string;
  userDefaultCurrency: string;
  userRecentCategories: readonly string[];
}
