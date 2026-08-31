/**
 * TASK-AI-005 — object storage is one of TASK-INFRA-010's declared adapter
 * categories ("LLM, STT, OCR, FX rate, object storage") that had no port
 * yet; this is the minimal slice FR-STT-006 actually needs (read access to
 * an already-uploaded audio file by its storage URI — the *upload* itself
 * is the Bot Application Layer's responsibility per §6.12.2's sequence
 * diagram, a different, not-yet-built task, not this Worker's).
 */
export abstract class ObjectStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
