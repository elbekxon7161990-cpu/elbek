import { Global, Module } from '@nestjs/common';
import { VOICE_TRANSCRIPTION_QUEUE } from '@afa/domain';

import { SttTranscriptionQueueModule } from './stt-transcription.queue.module';
import { BullMqVoiceTranscriptionQueue } from './bullmq-voice-transcription-queue.repository';

/**
 * Binds @afa/domain's VOICE_TRANSCRIPTION_QUEUE port to the BullMQ producer.
 * `@Global()` — see user-repository.module.ts's TASK-MVP-002 comment for
 * why a sibling import under a shared parent module is not sufficient.
 */
@Global()
@Module({
  imports: [SttTranscriptionQueueModule],
  providers: [{ provide: VOICE_TRANSCRIPTION_QUEUE, useClass: BullMqVoiceTranscriptionQueue }],
  exports: [VOICE_TRANSCRIPTION_QUEUE],
})
export class VoiceTranscriptionQueueRepositoryModule {}
