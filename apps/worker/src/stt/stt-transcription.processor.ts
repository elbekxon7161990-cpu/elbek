import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { TranscribeVoiceMessageUseCase } from '@afa/application';
import type { VoiceTranscriptionJobPayload } from '@afa/domain';
import { STT_TRANSCRIPTION_QUEUE_NAME } from '@afa/infrastructure';

/**
 * TASK-AI-005 — the thin BullMQ wiring for §6.12.2's "Job dequeued" step.
 * All real logic (validation, STT call, confidence gating, extraction
 * hand-off) lives in `TranscribeVoiceMessageUseCase` (`@afa/application`),
 * already fully unit-tested with fakes; this class only dequeues,
 * dispatches, and reports — "the Worker must execute queues only" applies
 * here in the narrow sense that this file's only job IS queue execution,
 * with zero business logic of its own.
 *
 * Never logs `job.data` wholesale (would include the Object Storage URI
 * and Telegram file ID, not the audio/transcript itself, but still kept
 * to a minimal safe field set per Chapter 16 §16.3 data minimization) —
 * only the outcome status, matching every other AI-layer component's
 * logging discipline in this codebase.
 *
 * A basic authorization sanity check (`job.data.userId` must be present)
 * guards against a malformed/tampered job payload reaching the
 * transcription pipeline at all — the actual authentication (verifying
 * the Telegram user who sent the voice message legitimately owns
 * `userId`) happens upstream, at enqueue time, in the Bot Application
 * Layer (a different, not-yet-built task).
 */
@Processor(STT_TRANSCRIPTION_QUEUE_NAME)
@Injectable()
export class SttTranscriptionProcessor extends WorkerHost {
  private readonly logger = new Logger(SttTranscriptionProcessor.name);

  constructor(private readonly transcribeVoiceMessage: TranscribeVoiceMessageUseCase) {
    super();
  }

  async process(job: Job<VoiceTranscriptionJobPayload>): Promise<{ status: string }> {
    if (!job.data.userId) {
      throw new Error(
        'STT job payload is missing userId — refusing to process an unauthenticated job.',
      );
    }

    const outcome = await this.transcribeVoiceMessage.execute(job.data);

    this.logger.log(`STT job ${job.id} completed with status="${outcome.status}"`);

    return { status: outcome.status };
  }
}
