import { describe, expect, it } from 'vitest';

import {
  computeDraftExpiresAt,
  computeDraftReminderDueAt,
  isDraftDueForReminder,
  isDraftExpired,
} from './is-draft-expired';

const LAST_INTERACTION = new Date('2026-01-01T00:00:00.000Z');

describe('isDraftExpired (FR-CE-021, 30-day boundary)', () => {
  const expiresAt = computeDraftExpiresAt(LAST_INTERACTION);

  it('is NOT expired at T-1ms', () => {
    const now = new Date(expiresAt.getTime() - 1);
    expect(isDraftExpired(LAST_INTERACTION, now)).toBe(false);
  });

  it('IS expired at exactly T', () => {
    expect(isDraftExpired(LAST_INTERACTION, expiresAt)).toBe(true);
  });

  it('IS expired at T+1ms', () => {
    const now = new Date(expiresAt.getTime() + 1);
    expect(isDraftExpired(LAST_INTERACTION, now)).toBe(true);
  });

  it('is NOT expired well before the boundary (29 days)', () => {
    const now = new Date(LAST_INTERACTION.getTime() + 29 * 24 * 60 * 60 * 1000);
    expect(isDraftExpired(LAST_INTERACTION, now)).toBe(false);
  });

  it('computes the boundary as exactly 30*24*60*60*1000ms after lastInteractionAt', () => {
    expect(expiresAt.getTime() - LAST_INTERACTION.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('isDraftDueForReminder (FR-CE-021, 7-day boundary)', () => {
  const dueAt = computeDraftReminderDueAt(LAST_INTERACTION);

  it('is NOT due at T-1ms', () => {
    const now = new Date(dueAt.getTime() - 1);
    expect(isDraftDueForReminder(LAST_INTERACTION, now)).toBe(false);
  });

  it('IS due at exactly T', () => {
    expect(isDraftDueForReminder(LAST_INTERACTION, dueAt)).toBe(true);
  });

  it('IS due at T+1ms', () => {
    const now = new Date(dueAt.getTime() + 1);
    expect(isDraftDueForReminder(LAST_INTERACTION, now)).toBe(true);
  });

  it('computes the boundary as exactly 7*24*60*60*1000ms after lastInteractionAt', () => {
    expect(dueAt.getTime() - LAST_INTERACTION.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
