import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { VoiceTranscriptionJobPayload, VoiceTranscriptionQueuePort } from '@afa/domain';

import { STT_TRANSCRIPTION_QUEUE_NAME } from './stt-transcription.queue.module';

/**
 * TASK-BOT-001's `VoiceTranscriptionQueuePort` implementation — a BullMQ
 * producer against the queue `SttTranscriptionQueueModule` (TASK-AI-005)
 * already registers. `jobId` is set to `payload.jobId` (the Bot Application
 * Layer derives this from Telegram's own file/update identifiers), so
 * BullMQ's own duplicate-jobId-is-a-no-op behavior gives idempotent
 * re-enqueueing for free on webhook redelivery — no separate dedup logic
 * needed at this layer.
 */
@Injectable()
export class BullMqVoiceTranscriptionQueue implements VoiceTranscriptionQueuePort {
  constructor(
    @InjectQueue(STT_TRANSCRIPTION_QUEUE_NAME)
    private readonly queue: Queue<VoiceTranscriptionJobPayload>,
  ) {}

  async enqueue(payload: VoiceTranscriptionJobPayload): Promise<void> {
    await this.queue.add(STT_TRANSCRIPTION_QUEUE_NAME, payload, { jobId: payload.jobId });
  }
}
