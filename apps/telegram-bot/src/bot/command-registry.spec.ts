import { describe, expect, it } from 'vitest';

import { COMMAND_DEFINITIONS, IMPLEMENTED_COMMANDS } from './command-registry';

describe('command-registry (TASK-BOT-001)', () => {
  it('every registered command has a non-empty description', () => {
    for (const definition of COMMAND_DEFINITIONS) {
      expect(definition.command.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
    }
  });

  it('every entry in IMPLEMENTED_COMMANDS is a real, registered command', () => {
    const registered = new Set(COMMAND_DEFINITIONS.map((d) => d.command));
    for (const command of IMPLEMENTED_COMMANDS) {
      expect(registered.has(command)).toBe(true);
    }
  });

  it('/report is registered and marked implemented (TASK-REP-TG)', () => {
    expect(COMMAND_DEFINITIONS.map((d) => d.command)).toContain('report');
    expect(IMPLEMENTED_COMMANDS.has('report')).toBe(true);
  });

  it('/export is registered and marked implemented (TASK-FIN-014)', () => {
    expect(COMMAND_DEFINITIONS.map((d) => d.command)).toContain('export');
    expect(IMPLEMENTED_COMMANDS.has('export')).toBe(true);
  });

  it('/settings is registered and marked implemented (TASK-BOT-SET)', () => {
    expect(COMMAND_DEFINITIONS.map((d) => d.command)).toContain('settings');
    expect(IMPLEMENTED_COMMANDS.has('settings')).toBe(true);
  });

  it('/undo is registered and marked implemented (TASK-FIN-013)', () => {
    expect(COMMAND_DEFINITIONS.map((d) => d.command)).toContain('undo');
    expect(IMPLEMENTED_COMMANDS.has('undo')).toBe(true);
  });
});
