import { describe, expect, it } from 'vitest';
import { starterSnippets } from '../../src/features/snippets/starters';
import { getTemplateVariables, resolveTemplate } from '../../src/features/snippets/template';

describe('starter snippets', () => {
  it('uses explicit template variables and stays plain text', () => {
    const snippets = starterSnippets(5);
    expect(new Set(snippets.map((snippet) => snippet.id)).size).toBe(snippets.length);
    for (const snippet of snippets) {
      expect(snippet.content).not.toMatch(/[<>]/);
      const names = getTemplateVariables(snippet.content);
      expect(names.every((name) => ['first_name', 'company', 'position'].includes(name))).toBe(
        true,
      );
      const values = Object.fromEntries(names.map((name) => [name, 'Ada']));
      expect(resolveTemplate(snippet.content, values)).not.toMatch(/\{\{/);
    }
  });
});
