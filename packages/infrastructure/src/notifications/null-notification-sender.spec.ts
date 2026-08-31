import { describe, expect, it } from 'vitest';

import { NullNotificationSender } from './null-notification-sender';

describe('NullNotificationSender', () => {
  it('throws rather than silently succeeding, so no caller can mistake it for a real delivery', async () => {
    const sender = new NullNotificationSender();

    await expect(sender.send()).rejects.toThrow(/not configured/i);
  });
});
