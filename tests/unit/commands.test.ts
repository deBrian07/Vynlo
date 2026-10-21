import { describe, expect, it, vi } from 'vitest';
import {
  createCommandRegistry,
  filterCommands,
  type Command,
} from '../../src/features/command-palette/registry';

const commands: Command[] = [
  {
    id: 'wait',
    title: 'Mark as Waiting',
    keywords: ['reply'],
    group: 'Conversation',
    run: vi.fn(),
  },
  { id: 'inbox', title: 'Go to Inbox', group: 'Gmail', run: vi.fn() },
  { id: 'reminder', title: 'Set a reminder', disabledReason: 'Open a conversation', run: vi.fn() },
];

describe('command registry', () => {
  it('supports fuzzy, keyword and multiword searches without losing stable order', () => {
    expect(filterCommands(commands, '')).toEqual(commands);
    expect(filterCommands(commands, 'inbx').map((c) => c.id)).toEqual(['inbox']);
    expect(filterCommands(commands, ' REPLY conversation ').map((c) => c.id)).toEqual(['wait']);
    expect(filterCommands(commands, 'zzzz')).toEqual([]);
    expect(filterCommands(commands, 'reminder')[0]?.disabledReason).toBe('Open a conversation');
  });
  it('rejects ambiguous command IDs', () => {
    expect(() => createCommandRegistry([...commands, commands[0]!])).toThrow('unique');
    expect(createCommandRegistry(commands)).toEqual(commands);
  });
});
