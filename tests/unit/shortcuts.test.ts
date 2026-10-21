import { describe, expect, it } from 'vitest';
import {
  formatShortcut,
  matchShortcut,
  validateShortcuts,
} from '../../src/features/shortcuts/shortcuts';

describe('keyboard shortcuts', () => {
  it('matches exact platform modifiers and physical punctuation codes', () => {
    expect(
      matchShortcut(
        new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true }),
        'Mod+K',
        'MacIntel',
      ),
    ).toBe(true);
    expect(
      matchShortcut(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }), 'Mod+K', 'Win32'),
    ).toBe(true);
    expect(
      matchShortcut(
        new KeyboardEvent('keydown', { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true }),
        'Mod+K',
        'Win32',
      ),
    ).toBe(false);
    expect(
      matchShortcut(
        new KeyboardEvent('keydown', { key: '>', code: 'Period', ctrlKey: true, shiftKey: true }),
        'Mod+Shift+Period',
        'Win32',
      ),
    ).toBe(true);
    expect(
      matchShortcut(
        new KeyboardEvent('keydown', { code: 'KeyK', ctrlKey: true, repeat: true }),
        'Mod+K',
        'Win32',
      ),
    ).toBe(false);
  });
  it('does not trigger in inputs or a shadow-root editor', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    shadow.append(editor);
    let matched = true;
    const handler = (event: KeyboardEvent) => {
      matched = matchShortcut(event, 'Mod+K', 'Win32');
    };
    document.addEventListener('keydown', handler);
    editor.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, composed: true }),
    );
    expect(matched).toBe(false);
    document.removeEventListener('keydown', handler);
    host.remove();
  });
  it('finds browser conflicts, duplicate bindings and unsupported combinations', () => {
    expect(
      validateShortcuts({
        palette: 'Mod+K',
        dashboard: 'Mod+Shift+Y',
        snippets: 'Mod+Shift+Period',
      }),
    ).toEqual({});
    expect(validateShortcuts({ palette: 'Mod+K', dashboard: 'Ctrl+K' })).toHaveProperty(
      'dashboard',
    );
    expect(validateShortcuts({ palette: 'Mod+L' })).toHaveProperty('palette');
    expect(validateShortcuts({ palette: 'K' })).toHaveProperty('palette');
    expect(validateShortcuts({ palette: 'Mod+Alt+K' })).toHaveProperty('palette');
    expect(formatShortcut('Mod+Shift+Period', 'MacIntel')).toBe('⌘⇧.');
    expect(formatShortcut('Mod+K', 'Win32')).toBe('Ctrl+K');
  });
});
