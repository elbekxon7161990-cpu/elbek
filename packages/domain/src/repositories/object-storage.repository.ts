import type { Buffer } from 'node:buffer';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/**
 * TASK-AI-005 originally shipped only the read side of TASK-INFRA-010's
 * declared "object storage" adapter category — fetching an already-uploaded
 * object by its storage URI — and explicitly deferred the write side to
 * "the Bot Application Layer's responsibility (§6.12.2's sequence diagram:
 * `BOT->>OS: upload raw audio`, before the job is even enqueued) — a
 * different, not-yet-built task, not this port's." That task is
 * TASK-BOT-001, which adds `putObject` here: the Bot Application Layer must
 * upload a voice/photo file it downloaded from Telegram before enqueuing
 * the STT/OCR job that references its URI (`VoiceTranscriptionJobPayload`/
 * `OcrExtractionJobPayload` both carry only the URI, never the bytes) — an
 * additive port extension, not a redefinition of the existing read method.
 */
export interface ObjectStoragePort {
  getObject(uri: string): Promise<Buffer>;
  putObject(uri: string, data: Buffer, contentType: string): Promise<void>;
  /**
   * TASK-AUTH-006 (FR-RET-002 — hard-purge "across PostgreSQL and Object
   * Storage") — additive, same precedent this port's own `putObject`
   * addition already established. Idempotent: deleting an already-absent
   * (or never-existing) object is not an error, matching this codebase's
   * general delete-semantics convention elsewhere (e.g.
   * `TransactionRepository.softDelete` treating "not there to delete" as a
   * safe outcome, not a thrown error) — a future purge job may retry safely.
   * Not wired to any purge orchestration by this task; see TASK-AUTH-006's
   * own final report for why (the purge job itself is not yet built,
   * pending unresolved product decisions).
   */
  deleteObject(uri: string): Promise<void>;
  /**
   * TASK-AUTH-006 (FR-RET-002) — additive, same precedent as this port's
   * own `putObject`/`deleteObject` additions. There is no persisted,
   * queryable record anywhere in the schema linking a committed
   * `Transaction` back to the raw audio/image URI that produced it
   * (`Transaction.sourceReference` holds a `transaction_drafts.id`, not a
   * storage URI — confirmed by reading every real usage site; the raw URI
   * only ever lives in the ephemeral, `removeOnComplete`d STT/OCR job
   * payload). The one thing that IS reliable is the URI *shape* those two
   * upload sites themselves establish (`RouteVoiceMessageUseCase`:
   * `voice/${userId}/${telegramFileId}.ogg`; `RoutePhotoMessageUseCase`:
   * `photo/${userId}/${telegramFileId}.${ext}`) — both deterministically
   * prefixed by the owning user's id. `deleteObjectsByPrefix` purges
   * everything under one such prefix without needing a DB-side URI index.
   * Idempotent (an absent/empty prefix deletes nothing, not an error) —
   * same convention as `deleteObject`.
   */
  deleteObjectsByPrefix(prefix: string): Promise<void>;
}
