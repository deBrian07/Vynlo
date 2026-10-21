type Platform = string;
interface Binding {
  ctrl: boolean;
  meta: boolean;
  mod: boolean;
  shift: boolean;
  alt: boolean;
  code: string;
}
const keyCodes: Record<string, string> = {
  period: 'Period',
  '.': 'Period',
  comma: 'Comma',
  ',': 'Comma',
  slash: 'Slash',
  '/': 'Slash',
  space: 'Space',
};
const reserved = new Set([
  'A',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'J',
  'L',
  'N',
  'O',
  'P',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Z',
]);

function platformDefault(): string {
  return typeof navigator === 'undefined' ? '' : navigator.platform;
}
function isMac(platform: Platform) {
  return /Mac|iPhone|iPad/i.test(platform);
}

function parse(binding: string): Binding | null {
  const parts = binding
    .trim()
    .toLowerCase()
    .split('+')
    .map((part) => part.trim());
  const key = parts.pop();
  if (!key || !parts.length || new Set(parts).size !== parts.length) return null;
  if (parts.some((part) => !['mod', 'ctrl', 'meta', 'shift', 'alt'].includes(part))) return null;
  const code = /^[a-z]$/.test(key)
    ? `Key${key.toUpperCase()}`
    : /^\d$/.test(key)
      ? `Digit${key}`
      : keyCodes[key];
  if (!code || !parts.some((part) => ['mod', 'ctrl', 'meta'].includes(part))) return null;
  if (parts.includes('mod') && (parts.includes('meta') || parts.includes('ctrl'))) return null;
  if (parts.includes('meta') && parts.includes('ctrl')) return null;
  return {
    ctrl: parts.includes('ctrl'),
    meta: parts.includes('meta'),
    mod: parts.includes('mod'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    code,
  };
}

export function isTypingEvent(event: KeyboardEvent): boolean {
  const path = event.composedPath();
  // The fallback also supports synthetic events without a composed path.
  const elements = path.length ? path : [event.target];
  return elements.some(
    (target) =>
      target instanceof Element &&
      Boolean(
        target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]',
        ),
      ),
  );
}

export function matchShortcut(
  event: KeyboardEvent,
  shortcut: string,
  platform = platformDefault(),
): boolean {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.getModifierState?.('AltGraph') ||
    isTypingEvent(event)
  )
    return false;
  const binding = parse(shortcut);
  if (!binding) return false;
  const meta = binding.meta || (binding.mod && isMac(platform));
  const ctrl = binding.ctrl || (binding.mod && !isMac(platform));
  let code: string | undefined = event.code;
  if (!code) {
    const key = event.key.toLowerCase();
    code = /^[a-z]$/.test(key)
      ? `Key${key.toUpperCase()}`
      : /^\d$/.test(key)
        ? `Digit${key}`
        : keyCodes[key];
  }
  return (
    event.metaKey === meta &&
    event.ctrlKey === ctrl &&
    event.shiftKey === binding.shift &&
    event.altKey === binding.alt &&
    code === binding.code
  );
}

export function validateShortcut(shortcut: string): string | undefined {
  if (!shortcut.trim()) return undefined;
  const binding = parse(shortcut);
  if (!binding)
    return 'Use Mod, Ctrl or Meta with a letter, number, Period, Comma, Slash or Space; Shift is optional.';
  const key = binding.code.replace(/^Key/, '');
  if (binding.alt)
    return 'Alt combinations may conflict with keyboard layouts. Choose a shortcut without Alt.';
  if (
    binding.code.startsWith('Digit') ||
    binding.code === 'Space' ||
    (reserved.has(key) && !binding.shift) ||
    (binding.shift &&
      [
        'A',
        'B',
        'C',
        'D',
        'G',
        'I',
        'J',
        'L',
        'M',
        'N',
        'O',
        'P',
        'R',
        'T',
        'V',
        'W',
        'Z',
      ].includes(key))
  ) {
    return 'This shortcut is reserved by common browser or Gmail actions.';
  }
  return undefined;
}

export function validateShortcuts(bindings: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  const seen = new Map<string, string>();
  for (const [action, shortcut] of Object.entries(bindings)) {
    const error = validateShortcut(shortcut);
    if (error) {
      errors[action] = error;
      continue;
    }
    const binding = parse(shortcut);
    if (!binding) continue;
    // Treat Ctrl/Meta/Mod alike to avoid platform-dependent duplicate bindings.
    const canonical = `${binding.shift}:${binding.alt}:${binding.code}`;
    const duplicate = seen.get(canonical);
    if (duplicate) {
      errors[action] = `This shortcut is also assigned to ${duplicate}.`;
      errors[duplicate] = `This shortcut is also assigned to ${action}.`;
    } else seen.set(canonical, action);
  }
  return errors;
}

export function formatShortcut(shortcut: string, platform = platformDefault()): string {
  if (!shortcut) return 'Not assigned';
  return shortcut
    .split('+')
    .map((part) => {
      const key = part.trim().toLowerCase();
      if (key === 'mod') return isMac(platform) ? '⌘' : 'Ctrl';
      if (key === 'meta') return isMac(platform) ? '⌘' : 'Meta';
      if (key === 'shift') return isMac(platform) ? '⇧' : 'Shift';
      if (key === 'alt') return isMac(platform) ? '⌥' : 'Alt';
      if (key === 'period') return '.';
      if (key === 'comma') return ',';
      if (key === 'slash') return '/';
      return part.toUpperCase();
    })
    .join(isMac(platform) ? '' : '+');
}
