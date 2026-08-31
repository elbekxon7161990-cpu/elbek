import type { SttProvider, SttTranscriptionRequest, SttTranscriptionResult } from '@afa/domain';

/**
 * NFR-STT-003 ("with fallback per Chapter 4 §4.9") / §6.18.3. Falls back to
 * `secondary` on any failure from `primary`, mirroring `FallbackLlmProvider`
 * (TASK-INFRA-010).
 */
export class FallbackSttProvider implements SttProvider {
  constructor(
    private readonly primary: SttProvider,
    private readonly secondary: SttProvider,
  ) {}

  async transcribe(request: SttTranscriptionRequest): Promise<SttTranscriptionResult> {
    try {
      return await this.primary.transcribe(request);
    } catch {
      return this.secondary.transcribe(request);
    }
  }
}
