import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  OcrProviderInvalidImageError,
  OcrProviderMalformedResponseError,
  OcrProviderUnavailableError,
} from '@afa/domain';

import { AnthropicVisionOcrProvider } from './anthropic-vision-ocr-provider';

function fakeClient(createImpl: (...args: unknown[]) => unknown): Anthropic {
  return { messages: { create: vi.fn(createImpl) } } as unknown as Anthropic;
}

function toolUseResponse(input: Record<string, unknown>): Anthropic.Messages.Message {
  return {
    id: 'msg_1',
    model: 'claude-sonnet-5',
    role: 'assistant',
    type: 'message',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
    content: [
      { type: 'tool_use', id: 'tool_1', name: 'report_ocr_result', input },
    ],
  } as unknown as Anthropic.Messages.Message;
}

const VALID_REQUEST = {
  image: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
  mimeType: 'image/jpeg',
  contentHint: 'receipt' as const,
};

describe('AnthropicVisionOcrProvider', () => {
  it('sends the image as a base64 content block alongside a text instruction, forcing the structured-output tool', async () => {
    const create = vi.fn().mockResolvedValue(
      toolUseResponse({
        rawText: 'MAGAZIN\nJami: 45000 UZS',
        contentClassification: 'receipt',
        detectedLanguage: 'uz',
        confidence: 0.9,
      }),
    );
    const client = { messages: { create } } as unknown as Anthropic;
    const provider = new AnthropicVisionOcrProvider(client, 'claude-sonnet-5', 30_000);

    const result = await provider.extractText(VALID_REQUEST);

    expect(result).toEqual({
      rawText: 'MAGAZIN\nJami: 45000 UZS',
      contentClassification: 'receipt',
      detectedLanguage: 'uz',
      confidence: 0.9,
      providerModelIdentifier: 'claude-sonnet-5',
      processingDurationMs: expect.any(Number),
    });

    const callArgs = create.mock.calls[0]![0] as Anthropic.Messages.MessageCreateParams;
    expect(callArgs.tool_choice).toEqual({ type: 'tool', name: 'report_ocr_result' });
    const content = callArgs.messages[0]!.content as Anthropic.Messages.ContentBlockParam[];
    const imageBlock = content.find((b) => b.type === 'image') as Anthropic.Messages.ImageBlockParam;
    expect(imageBlock.source).toEqual({
      type: 'base64',
      media_type: 'image/jpeg',
      data: VALID_REQUEST.image.toString('base64'),
    });
  });

  it('rejects an unsupported media type before ever calling the SDK', async () => {
    const create = vi.fn();
    const client = { messages: { create } } as unknown as Anthropic;
    const provider = new AnthropicVisionOcrProvider(client, 'claude-sonnet-5', 30_000);

    await expect(
      provider.extractText({ ...VALID_REQUEST, mimeType: 'application/pdf' }),
    ).rejects.toBeInstanceOf(OcrProviderInvalidImageError);
    expect(create).not.toHaveBeenCalled();
  });

  it('throws OcrProviderMalformedResponseError when no tool_use block is present', async () => {
    const client = fakeClient(() =>
      Promise.resolve({
        ...toolUseResponse({}),
        content: [{ type: 'text', text: 'I refuse to use tools.' }],
      }),
    );
    const provider = new AnthropicVisionOcrProvider(client, 'claude-sonnet-5', 30_000);

    await expect(provider.extractText(VALID_REQUEST)).rejects.toBeInstanceOf(
      OcrProviderMalformedResponseError,
    );
  });

  it('throws OcrProviderMalformedResponseError when the tool input is missing required fields', async () => {
    const client = fakeClient(() => Promise.resolve(toolUseResponse({ rawText: 'only this' })));
    const provider = new AnthropicVisionOcrProvider(client, 'claude-sonnet-5', 30_000);

    await expect(provider.extractText(VALID_REQUEST)).rejects.toBeInstanceOf(
      OcrProviderMalformedResponseError,
    );
  });

  it('defaults a missing/undefined detectedLanguage to null rather than throwing', async () => {
    const client = fakeClient(() =>
      Promise.resolve(
        toolUseResponse({ rawText: 'text', contentClassification: 'unknown', confidence: 0.2 }),
      ),
    );
    const provider = new AnthropicVisionOcrProvider(client, 'claude-sonnet-5', 30_000);

    const result = await provider.extractText(VALID_REQUEST);
    expect(result.detectedLanguage).toBeNull();
  });

  it('maps an unexpected SDK error to OcrProviderUnavailableError, never leaking the raw error', async () => {
    const client = fakeClient(() => Promise.reject(new Error('connect ECONNREFUSED 1.2.3.4:443')));
    const provider = new AnthropicVisionOcrProvider(client, 'claude-sonnet-5', 30_000);

    let thrown: unknown;
    try {
      await provider.extractText(VALID_REQUEST);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OcrProviderUnavailableError);
    expect((thrown as Error).message).not.toContain('1.2.3.4');
  });

  it('the mapped error message never contains an API key or credential-shaped string', async () => {
    const client = fakeClient(() =>
      Promise.reject(new Error('Invalid API key: sk-ant-api03-SECRET12345')),
    );
    const provider = new AnthropicVisionOcrProvider(client, 'claude-sonnet-5', 30_000);

    let message = '';
    try {
      await provider.extractText(VALID_REQUEST);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('sk-ant');
    expect(message).not.toContain('SECRET12345');
  });
});
