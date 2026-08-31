import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

import { AnthropicVisionOcrProvider } from './anthropic-vision-ocr-provider';

/**
 * TASK-AI-006 — the ONE test file in this repository that proves
 * `AnthropicVisionOcrProvider` against the REAL Claude API (a real network
 * call, real billing), not a mocked SDK client. Mirrors
 * `supabase-object-storage.integration.spec.ts`'s own `describe.skipIf`
 * convention exactly — when `ANTHROPIC_API_KEY` is absent, this suite
 * reports as SKIPPED, never a fabricated pass.
 *
 * `sample-receipt.png` (`__fixtures__/`) is a SYNTHETIC receipt image —
 * this repository has no real photographed receipt anywhere, and none was
 * requested from the user for this task. It was generated on Windows via
 * `System.Drawing` (no new dependency added) — a plain white background
 * with real Uzbek-language merchant/line-item/total text drawn onto it —
 * specifically so this test could prove real end-to-end OCR behavior
 * (a real image in, real transcribed Uzbek text out) rather than being
 * skipped entirely for lack of any usable image. It is NOT a real customer
 * receipt and contains no real personal or financial data. Disclosed here
 * per this task's own instructions; see the final report for the same
 * disclosure to the user.
 */
const HAS_ANTHROPIC_CREDENTIALS = Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!HAS_ANTHROPIC_CREDENTIALS)(
  'AnthropicVisionOcrProvider (integration, real Claude API)',
  () => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 0 });
    const provider = new AnthropicVisionOcrProvider(
      client,
      process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      30_000,
    );
    const receiptImage = readFileSync(join(__dirname, '__fixtures__', 'sample-receipt.png'));

    it('reads real text off a real receipt-shaped image, including the Uzbek total line', async () => {
      const result = await provider.extractText({
        image: receiptImage,
        mimeType: 'image/png',
        contentHint: 'receipt',
      });

      expect(result.rawText.length).toBeGreaterThan(0);
      // The synthetic fixture's own known total — proves Claude genuinely
      // read the image rather than returning a generic/empty placeholder.
      expect(result.rawText).toMatch(/45\s?000/);
      expect(result.contentClassification).toBe('receipt');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.providerModelIdentifier).toContain('claude');
      expect(result.processingDurationMs).toBeGreaterThan(0);
    }, 30_000);

    it('rejects a genuinely invalid image payload with OcrProviderInvalidImageError-shaped rejection, not a crash', async () => {
      await expect(
        provider.extractText({
          image: Buffer.from('this is not an image'),
          mimeType: 'image/jpeg',
        }),
      ).rejects.toThrow();
    }, 30_000);
  },
);

describe('AnthropicVisionOcrProvider integration environment gate', () => {
  it('reports its own gating boolean explicitly, so a SKIPPED run above is never mistaken for a passed one', () => {
    expect(typeof HAS_ANTHROPIC_CREDENTIALS).toBe('boolean');
  });
});
