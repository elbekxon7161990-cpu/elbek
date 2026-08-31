import { describe, expect, it } from 'vitest';

import { isValidApiTokenScope } from './is-valid-api-token-scope';

describe('isValidApiTokenScope', () => {
  it.each([
    'transactions:read',
    'transactions:write',
    'reports:read',
    'ai:invoke',
    'admin:categories:write',
  ])('accepts %s (a PRD-cited example)', (scope) => {
    expect(isValidApiTokenScope(scope)).toBe(true);
  });

  it.each([
    '',
    'transactions',
    'transactions:',
    ':read',
    'Transactions:Read',
    'transactions:read:extra:extra',
    'transactions read',
    'transactions:re ad',
    'transactions:read;DROP TABLE',
  ])('rejects malformed scope %s', (scope) => {
    expect(isValidApiTokenScope(scope)).toBe(false);
  });
});
