export interface Command {
  id: string;
  title: string;
  keywords?: string[];
  group?: string;
  shortcut?: string;
  disabledReason?: string;
  run: () => void | Promise<void>;
}

/** Stable ranking: exact and word-prefix matches precede subsequence matches. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return commands;
  return commands
    .map((command, index) => {
      const title = command.title.toLocaleLowerCase();
      const text = [title, ...(command.keywords ?? []), command.group ?? '']
        .join(' ')
        .toLocaleLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (title === token) {
          score += 100;
          continue;
        }
        if (title.split(/\s+/).some((word) => word.startsWith(token))) {
          score += 50;
          continue;
        }
        if (text.includes(token)) {
          score += 30;
          continue;
        }
        let position = -1;
        let gaps = 0;
        for (const letter of token) {
          const next = text.indexOf(letter, position + 1);
          if (next < 0) return null;
          gaps += next - position - 1;
          position = next;
        }
        score += 10 / (gaps + 1);
      }
      return { command, score, index };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ command }) => command);
}

export function createCommandRegistry(commands: Command[]): Command[] {
  const ids = new Set<string>();
  for (const command of commands) {
    if (!command.id || ids.has(command.id)) throw new Error('Commands need unique, nonempty IDs.');
    ids.add(command.id);
  }
  return [...commands];
}
