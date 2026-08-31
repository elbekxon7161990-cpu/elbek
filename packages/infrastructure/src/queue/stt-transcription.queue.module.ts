import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

/**
 * TASK-AI-005 (Chapter 3 §3.3.3 Job Queue & Worker Pool; ADR-INP-005 —
 * "Worker capacity scales independently per modality, not as one
 * undifferentiated pool") — this is STT's own dedicated queue, not a
 * shared/undifferentiated one, so a surge in another modality's jobs can
 * never starve voice-message processing capacity.
 *
 * Registers only the queue itself (name + default job policy) — the
 * `@Processor` that actually consumes it lives in `apps/worker` (a
 * composition-root concern that depends on `@afa/application`'s
 * `TranscribeVoiceMessageUseCase`; this package must never depend on
 * `@afa/application` — IMPLEMENTATION-BLUEPRINT.md §2's package-boundary
 * table).
 *
 * `attempts`/`backoff` here are BullMQ's own outer retry safety net for
 * infrastructure-level failures (a crashed worker process, a Redis
 * hiccup) — provider-level transience (STT timeouts/rate-limits) is
 * already handled *inside* `TranscribeVoiceMessageUseCase` by whichever
 * `RetryingSttProvider`/`CircuitBreakerSttProvider`/`FallbackSttProvider`
 * composition wraps the injected `SttProvider`, so this outer layer rarely
 * needs to fire in practice. `removeOnFail: false` keeps a failed job
 * visible for FR-STT-007 follow-up/observability rather than silently
 * vanishing.
 */
export const STT_TRANSCRIPTION_QUEUE_NAME = 'stt-transcription';

@Module({
  imports: [
    BullModule.registerQueue({
      name: STT_TRANSCRIPTION_QUEUE_NAME,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
  ],
  exports: [BullModule],
})
export class SttTranscriptionQueueModule {}
