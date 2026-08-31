import { SttProviderError } from './stt-provider.error';

/**
 * The provider itself rejected the audio (e.g. genuinely corrupted beyond
 * what our own pre-flight `evaluateAudioValidity` check could detect, or
 * an encoding the provider doesn't support despite passing our MIME check)
 * — distinct from `evaluateAudioValidity`'s own pre-call validation, which
 * returns a result rather than throwing (see `evaluate-audio-validity.ts`).
 */
export class SttProviderInvalidAudioError extends SttProviderError {
  constructor(providerName: string, reason: string) {
    super(`STT provider "${providerName}" rejected the audio: ${reason}`);
  }
}
