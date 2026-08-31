import { describe, expect, it, vi } from 'vitest';
import type { RedisClient } from '@afa/infrastructure';

import { TelegramUpdateDedupService } from './telegram-update-dedup.service';

describe('TelegramUpdateDedupService', () => {
  it('returns false (not a duplicate) the first time an update_id is seen, and issues an atomic SET NX EX', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    const redis = { set } as unknown as RedisClient;
    const service = new TelegramUpdateDedupService(redis);

    const isDuplicate = await service.isDuplicate(12345);

    expect(isDuplicate).toBe(false);
    expect(set).toHaveBeenCalledWith('telegram_update:12345', '1', 'EX', 24 * 60 * 60, 'NX');
  });

  it('returns true (a duplicate) when the key already existed (SET NX returns null)', async () => {
    const set = vi.fn().mockResolvedValue(null);
    const redis = { set } as unknown as RedisClient;
    const service = new TelegramUpdateDedupService(redis);

    const isDuplicate = await service.isDuplicate(12345);

    expect(isDuplicate).toBe(true);
  });

  it('uses a distinct key per update_id', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    const redis = { set } as unknown as RedisClient;
    const service = new TelegramUpdateDedupService(redis);

    await service.isDuplicate(1);
    await service.isDuplicate(2);

    expect(set).toHaveBeenNthCalledWith(
      1,
      'telegram_update:1',
      '1',
      'EX',
      expect.any(Number),
      'NX',
    );
    expect(set).toHaveBeenNthCalledWith(
      2,
      'telegram_update:2',
      '1',
      'EX',
      expect.any(Number),
      'NX',
    );
  });
});
