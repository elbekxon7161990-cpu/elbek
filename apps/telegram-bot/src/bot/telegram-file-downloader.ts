import { Buffer } from 'node:buffer';
import type { Telegram } from 'telegraf';

/**
 * TASK-BOT-001 (§3.3.2 — "file download from Telegram's file API"; §6.12.2/
 * §6.13.2's sequence diagrams' first step, before the Bot Application Layer
 * uploads to Object Storage). Telegram's Bot API file size (already present
 * on `ctx.message.voice.file_size`/`ctx.message.photo[i].file_size`) is
 * read directly from the update by the caller — this helper only fetches
 * the bytes.
 */
export async function downloadTelegramFile(telegram: Telegram, fileId: string): Promise<Buffer> {
  const link = await telegram.getFileLink(fileId);
  // eslint-disable-next-line no-undef -- global `fetch` (Node 18+ built-in), same ambient-global gap as `Buffer`/`setTimeout` elsewhere in this codebase.
  const response = await fetch(link.toString());
  if (!response.ok) {
    throw new Error(`Failed to download Telegram file ${fileId}: HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
