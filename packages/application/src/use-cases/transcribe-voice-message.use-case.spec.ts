import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
  ObjectStoragePort,
  SttProvider,
  SttProviderError,
  SttTranscriptionRequest,
  SttTranscriptionResult,
  VoiceTranscriptionJobPayload,
} from '@afa/domain';
import {
  ObjectNotFoundError,
  SttProviderAuthenticationError,
  SttProviderInvalidAudioError,
  SttProviderMalformedResponseError,
  SttProviderRateLimitError,
  SttProviderTimeoutError,
} from '@afa/domain';

import { ValidateStructuredAiOutputUseCase } from './validate-structured-ai-output.use-case';
import { ExtractTransactionCandidatesUseCase } from './extract-transaction-candidates.use-case';
import type { ExtractionModelConfig } from './extract-transaction-candidates.use-case';
import { TranscribeVoiceMessageUseCase } from './transcribe-voice-message.use-case';

interface LlmFakeStep {
  result?: LlmCompletionResult;
}

/** Local fake — @afa/application never depends on @afa/infrastructure, even in tests (established convention across every AI-* spec in this package). */
class LocalFakeLlmProvider implements LlmProvider {
  private readonly calls: LlmCompletionRequest[] = [];
  private readonly script: LlmFakeStep[] = [];
  constructor(private readonly defaultResult: LlmCompletionResult) {}
  enqueue(step: LlmFakeStep): this {
    this.script.push(step);
    return this;
  }
  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    this.calls.push(request);
    return this.script.shift()?.result ?? this.defaultResult;
  }
  get callCount(): number {
    return this.calls.length;
  }
  get lastRequest(): LlmCompletionRequest | undefined {
    return this.calls.at(-1);
  }
}

interface SttFakeStep {
  result?: SttTranscriptionResult;
  error?: SttProviderError;
}

class LocalFakeSttProvider implements SttProvider {
  private readonly calls: SttTranscriptionRequest[] = [];
  private readonly script: SttFakeStep[] = [];
  constructor(private readonly defaultResult: SttTranscriptionResult) {}
  enqueue(step: SttFakeStep): this {
    this.script.push(step);
    return this;
  }
  async transcribe(request: SttTranscriptionRequest): Promise<SttTranscriptionResult> {
    this.calls.push(request);
    const next = this.script.shift();
    if (next?.error) throw next.error;
    return next?.result ?? this.defaultResult;
  }
  get callCount(): number {
    return this.calls.length;
  }
  get lastRequest(): SttTranscriptionRequest | undefined {
    return this.calls.at(-1);
  }
}

class LocalFakeObjectStorage implements ObjectStoragePort {
  private readonly objects = new Map<string, Buffer>();
  put(uri: string, data: Buffer): void {
    this.objects.set(uri, data);
  }
  async getObject(uri: string): Promise<Buffer> {
    const data = this.objects.get(uri);
    if (!data) throw new ObjectNotFoundError(uri);
    return data;
  }
  async putObject(uri: string, data: Buffer): Promise<void> {
    this.objects.set(uri, data);
  }
  async deleteObject(uri: string): Promise<void> {
    this.objects.delete(uri);
  }
  async deleteObjectsByPrefix(prefix: string): Promise<void> {
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) {
        this.objects.delete(key);
      }
    }
  }
}

function sttResult(overrides: Partial<SttTranscriptionResult> = {}): SttTranscriptionResult {
  return {
    transcript: 'spent 45000 on lunch',
    detectedLanguage: 'en',
    confidence: 0.95,
    durationSeconds: 3,
    providerModelIdentifier: 'fake-stt-model',
    ...overrides,
  };
}

function llmCandidateJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intent: 'EXPENSE',
    amount: 45000,
    currency: 'UZS',
    category: 'FOOD_DINING',
    subcategory: null,
    merchant: null,
    paymentMethod: null,
    transactionDate: '2026-08-14',
    transactionTime: null,
    location: null,
    counterparty: null,
    dueDate: null,
    tags: [],
    description: 'Lunch',
    confidenceScores: {
      intent: 0.97,
      amount: 0.95,
      currency: 0.9,
      category: 0.9,
      transactionDate: 0.95,
    },
    ...overrides,
  };
}

function llmEnvelope(transactions: Record<string, unknown>[]): Record<string, unknown> {
  return {
    transactions,
    detectedLanguage: 'en',
    clarificationNeeded: false,
    clarificationQuestion: null,
  };
}

const AUDIO_URI = 's3://bucket/voice/msg-1.ogg';

function payload(
  overrides: Partial<VoiceTranscriptionJobPayload> = {},
): VoiceTranscriptionJobPayload {
  return {
    jobId: 'job-1',
    userId: 'user-1',
    telegramFileId: 'AwACAgIA...',
    audioObjectStorageUri: AUDIO_URI,
    mimeType: 'audio/ogg',
    sizeBytes: 50_000,
    durationSeconds: 5,
    currentDateTime: '2026-08-14T10:00:00+05:00',
    userDefaultCurrency: 'UZS',
    userRecentCategories: ['FOOD_DINING'],
    ...overrides,
  };
}

function buildUseCase(
  sttProvider: SttProvider,
  storage: LocalFakeObjectStorage,
  llmResultJson: Record<string, unknown> = llmEnvelope([llmCandidateJson()]),
) {
  const llmProvider = new LocalFakeLlmProvider({
    content: JSON.stringify(llmResultJson),
    finishReason: 'stop',
  });
  const validate = new ValidateStructuredAiOutputUseCase(llmProvider);
  const config: ExtractionModelConfig = { model: 'fixture-model' };
  const extract = new ExtractTransactionCandidatesUseCase(validate, config);
  return { useCase: new TranscribeVoiceMessageUseCase(storage, sttProvider, extract), llmProvider };
}

function storageWithAudio(): LocalFakeObjectStorage {
  const storage = new LocalFakeObjectStorage();
  storage.put(AUDIO_URI, Buffer.from('fake-ogg-audio-bytes'));
  return storage;
}

describe('TranscribeVoiceMessageUseCase', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('transcribes a valid voice message and proceeds to extraction on high confidence (AC-INP-001)', async () => {
    const { useCase } = buildUseCase(new LocalFakeSttProvider(sttResult()), storageWithAudio());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('transcribed');
    if (outcome.status === 'transcribed') {
      expect(outcome.transcription.requiresConfirmation).toBe(false);
      expect(outcome.extraction.status).toBe('valid');
    }
  });

  it('transcribes Uzbek speech and passes it verbatim into the extraction pipeline (FR-STT-002/003)', async () => {
    const stt = new LocalFakeSttProvider(
      sttResult({ transcript: '50 ming ovqatga ketdi', detectedLanguage: 'uz' }),
    );
    const { useCase, llmProvider } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('transcribed');
    expect(llmProvider.lastRequest?.messages[0]?.content).toContain('50 ming ovqatga ketdi');
    if (outcome.status === 'transcribed') {
      expect(outcome.transcription.detectedLanguage).toBe('uz');
    }
  });

  it('transcribes Russian speech', async () => {
    const stt = new LocalFakeSttProvider(
      sttResult({ transcript: 'потратил 50 штук на обед', detectedLanguage: 'ru' }),
    );
    const { useCase } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('transcribed');
    if (outcome.status === 'transcribed') {
      expect(outcome.transcription.transcript).toBe('потратил 50 штук на обед');
    }
  });

  it('transcribes English speech', async () => {
    const stt = new LocalFakeSttProvider(
      sttResult({ transcript: 'spent fifty thousand on lunch', detectedLanguage: 'en' }),
    );
    const { useCase } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('transcribed');
  });

  it('transcribes mixed-language/code-switched speech without splitting it (FR-STT-002)', async () => {
    const stt = new LocalFakeSttProvider(
      sttResult({ transcript: 'Aziz ga 500 ming dollar berdim', detectedLanguage: 'uz' }),
    );
    const { useCase, llmProvider } = buildUseCase(stt, storageWithAudio());

    await useCase.execute(payload());

    expect(llmProvider.lastRequest?.messages[0]?.content).toContain(
      'Aziz ga 500 ming dollar berdim',
    );
  });

  it('rejects empty audio before ever calling the STT provider', async () => {
    const stt = new LocalFakeSttProvider(sttResult());
    const { useCase } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload({ sizeBytes: 0 }));

    expect(outcome).toEqual({ status: 'invalid_audio', reason: 'EMPTY_AUDIO' });
    expect(stt.callCount).toBe(0);
  });

  it('rejects an unsupported MIME type before calling the STT provider', async () => {
    const stt = new LocalFakeSttProvider(sttResult());
    const { useCase } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload({ mimeType: 'audio/mpeg' }));

    expect(outcome).toEqual({ status: 'invalid_audio', reason: 'UNSUPPORTED_FORMAT' });
    expect(stt.callCount).toBe(0);
  });

  it('rejects oversized audio before calling the STT provider', async () => {
    const stt = new LocalFakeSttProvider(sttResult());
    const { useCase } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload({ sizeBytes: 100 * 1024 * 1024 }));

    expect(outcome).toEqual({ status: 'invalid_audio', reason: 'OVERSIZED' });
  });

  it('rejects audio exceeding the duration guard (§6.2.4) before calling the STT provider', async () => {
    const stt = new LocalFakeSttProvider(sttResult());
    const { useCase } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload({ durationSeconds: 200 }));

    expect(outcome).toEqual({ status: 'invalid_audio', reason: 'DURATION_EXCEEDED' });
  });

  it('reports a storage failure when the referenced audio object does not exist (missing Telegram file)', async () => {
    const stt = new LocalFakeSttProvider(sttResult());
    const { useCase } = buildUseCase(stt, new LocalFakeObjectStorage()); // nothing uploaded

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('storage_failure');
  });

  it('succeeds when the STT provider succeeds (baseline)', async () => {
    const stt = new LocalFakeSttProvider(sttResult());
    const { useCase } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('transcribed');
  });

  it('maps a provider timeout to stt_failed (FR-STT-007) rather than throwing', async () => {
    const stt = new LocalFakeSttProvider(sttResult());
    stt.enqueue({ error: new SttProviderTimeoutError('fake', 8000) });
    const { useCase } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('stt_failed');
  });

  it('maps a provider rate-limit error to stt_failed', async () => {
    const stt = new LocalFakeSttProvider(sttResult());
    stt.enqueue({ error: new SttProviderRateLimitError('fake', 5000) });
    const { useCase } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('stt_failed');
  });

  it('maps a provider authentication error to stt_failed', async () => {
    const stt = new LocalFakeSttProvider(sttResult());
    stt.enqueue({ error: new SttProviderAuthenticationError('fake') });
    const { useCase } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('stt_failed');
  });

  it('maps corrupted-audio provider rejection to stt_failed', async () => {
    const stt = new LocalFakeSttProvider(sttResult());
    stt.enqueue({ error: new SttProviderInvalidAudioError('fake', 'corrupted stream') });
    const { useCase } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('stt_failed');
  });

  it('maps a malformed provider response to stt_failed', async () => {
    const stt = new LocalFakeSttProvider(sttResult());
    stt.enqueue({ error: new SttProviderMalformedResponseError('fake') });
    const { useCase } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('stt_failed');
  });

  it('treats an empty transcript as a total STT failure (FR-STT-007), never proceeding to extraction', async () => {
    const stt = new LocalFakeSttProvider(sttResult({ transcript: '' }));
    const { useCase } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('stt_failed');
  });

  it('treats a whitespace-only transcript as an empty transcript', async () => {
    const stt = new LocalFakeSttProvider(sttResult({ transcript: '   ' }));
    const { useCase } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('stt_failed');
  });

  it('requires confirmation for a low-confidence transcript and does NOT proceed to extraction (FR-STT-005)', async () => {
    const stt = new LocalFakeSttProvider(sttResult({ confidence: 0.4 }));
    const { useCase, llmProvider } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('confirmation_required');
    expect(llmProvider.callCount).toBe(0);
  });

  it('exposes the transcript for confirmation even when extraction is withheld', async () => {
    const stt = new LocalFakeSttProvider(
      sttResult({ confidence: 0.3, transcript: '50 ming taxiga ketdi' }),
    );
    const { useCase } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('confirmation_required');
    if (outcome.status === 'confirmation_required') {
      expect(outcome.transcription.transcript).toBe('50 ming taxiga ketdi');
    }
  });

  it('never calls the extraction pipeline before the STT provider has returned', async () => {
    const stt = new LocalFakeSttProvider(sttResult());
    const { useCase, llmProvider } = buildUseCase(stt, storageWithAudio());

    await useCase.execute(payload());

    expect(llmProvider.callCount).toBe(1); // exactly one extraction call, after transcription
  });

  it('carries the audio object storage URI through into the structured result (FR-STT-006 linkage)', async () => {
    const stt = new LocalFakeSttProvider(sttResult());
    const { useCase } = buildUseCase(stt, storageWithAudio());

    const outcome = await useCase.execute(payload());

    expect(outcome.status).toBe('transcribed');
    if (outcome.status === 'transcribed') {
      expect(outcome.transcription.audioObjectStorageUri).toBe(AUDIO_URI);
      expect(outcome.transcription.sourceType).toBe('voice');
    }
  });

  it('is idempotent — running the same job payload twice against fresh fakes produces the same outcome shape, and never touches persistence itself', async () => {
    const first = buildUseCase(new LocalFakeSttProvider(sttResult()), storageWithAudio());
    const second = buildUseCase(new LocalFakeSttProvider(sttResult()), storageWithAudio());

    const outcomeA = await first.useCase.execute(payload());
    const outcomeB = await second.useCase.execute(payload());

    expect(outcomeA.status).toBe(outcomeB.status);
    // This use case never imports/calls Prisma or any repository — structurally
    // incapable of creating a duplicate transaction record on a re-run.
  });

  it('normalizes the transcript (whitespace) before handing it to the extraction pipeline', async () => {
    const stt = new LocalFakeSttProvider(sttResult({ transcript: '  spent   45000   on lunch  ' }));
    const { useCase, llmProvider } = buildUseCase(stt, storageWithAudio());

    await useCase.execute(payload());

    expect(llmProvider.lastRequest?.messages[0]?.content).toContain('spent 45000 on lunch');
  });

  it('never logs the audio bytes, provider payload, or transcript content to the console', async () => {
    const stt = new LocalFakeSttProvider(
      sttResult({ transcript: 'sensitive financial detail 45000' }),
    );
    const { useCase } = buildUseCase(stt, storageWithAudio());

    await useCase.execute(payload());

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('propagates a non-provider, non-storage error (unexpected infrastructure fault) rather than masking it', async () => {
    const stt: SttProvider = {
      transcribe: () => {
        throw new Error('unexpected infra fault');
      },
    };
    const { useCase } = buildUseCase(stt, storageWithAudio());

    await expect(useCase.execute(payload())).rejects.toThrow('unexpected infra fault');
  });
});
