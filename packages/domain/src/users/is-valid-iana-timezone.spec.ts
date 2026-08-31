import { describe, expect, it } from 'vitest';

import { isValidIanaTimezone } from './is-valid-iana-timezone';

describe('isValidIanaTimezone (FR-PROF-003)', () => {
  it.each(['Asia/Tashkent', 'Europe/Moscow', 'Europe/London', 'UTC', 'America/New_York'])(
    'accepts the real IANA identifier "%s"',
    (timezone) => {
      expect(isValidIanaTimezone(timezone)).toBe(true);
    },
  );

  it.each(['Not/A_Real_Zone', 'Tashkent', '', 'GMT+5'])(
    'rejects the invalid identifier "%s"',
    (timezone) => {
      expect(isValidIanaTimezone(timezone)).toBe(false);
    },
  );
});
