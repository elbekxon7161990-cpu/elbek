import { Global, Module } from '@nestjs/common';
import { OCR_EXTRACTION_QUEUE } from '@afa/domain';

import { OcrExtractionQueueModule } from './ocr-extraction.queue.module';
import { BullMqOcrExtractionQueue } from './bullmq-ocr-extraction-queue.repository';

/**
 * Binds @afa/domain's OCR_EXTRACTION_QUEUE port to the BullMQ producer.
 * `@Global()` — see user-repository.module.ts's TASK-MVP-002 comment for
 * why a sibling import under a shared parent module is not sufficient.
 */
@Global()
@Module({
  imports: [OcrExtractionQueueModule],
  providers: [{ provide: OCR_EXTRACTION_QUEUE, useClass: BullMqOcrExtractionQueue }],
  exports: [OCR_EXTRACTION_QUEUE],
})
export class OcrExtractionQueueRepositoryModule {}
