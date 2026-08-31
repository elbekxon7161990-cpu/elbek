import { Module } from '@nestjs/common';

import { ValidateStructuredAiOutputUseCase } from '../use-cases/validate-structured-ai-output.use-case';
import { ExtractTransactionCandidatesUseCase } from '../use-cases/extract-transaction-candidates.use-case';
import { RunCalibrationEvaluationUseCase } from '../use-cases/run-calibration-evaluation.use-case';
import { TranscribeVoiceMessageUseCase } from '../use-cases/transcribe-voice-message.use-case';
import { ProcessReceiptImageUseCase } from '../use-cases/process-receipt-image.use-case';

/**
 * TASK-AI-001/TASK-AI-002/TASK-AI-004/TASK-AI-005/TASK-AI-006 — does not
 * bind `LLM_PROVIDER`, `EXTRACTION_MODEL_CONFIG`, `STT_PROVIDER`,
 * `OCR_PROVIDER`, `OBJECT_STORAGE`, `DRAFT_REPOSITORY`,
 * `NOTIFICATION_REPOSITORY`, or `NOTIFICATION_DELIVERY_QUEUE`; binding them
 * to a real (or resilience-wrapped fake/test) implementation is the
 * composition root's job, same split as every other *RepositoryModule in
 * this codebase.
 */
@Module({
  providers: [
    ValidateStructuredAiOutputUseCase,
    ExtractTransactionCandidatesUseCase,
    RunCalibrationEvaluationUseCase,
    TranscribeVoiceMessageUseCase,
    ProcessReceiptImageUseCase,
  ],
  exports: [
    ValidateStructuredAiOutputUseCase,
    ExtractTransactionCandidatesUseCase,
    RunCalibrationEvaluationUseCase,
    TranscribeVoiceMessageUseCase,
    ProcessReceiptImageUseCase,
  ],
})
export class AiExtractionModule {}
