import { describe, expect, it } from 'vitest';
import { getTemplateVariables, resolveTemplate } from '../../src/features/snippets/template';

describe('snippet templates', () => {
  it('extracts unique, explicitly named variables and replaces all occurrences', () => {
    expect(getTemplateVariables('Hi {{first_name}}, {{ company }} / {{first_name}}')).toEqual([
      'first_name',
      'company',
    ]);
    expect(resolveTemplate('{{first_name}} / {{first_name}}', { first_name: 'Alex' })).toBe(
      'Alex / Alex',
    );
  });
  it('rejects missing, blank, inherited and malformed variable values', () => {
    expect(() => resolveTemplate('{{company}}', {})).toThrow('company');
    expect(() => resolveTemplate('{{company}}', { company: ' ' })).toThrow('company');
    expect(() => resolveTemplate('{{constructor}}', {})).toThrow('constructor');
    expect(() => getTemplateVariables('{{missing')).toThrow('braces');
    expect(() => getTemplateVariables('{{person.name}}')).toThrow('variable names');
  });
  it('preserves HTML-like and dollar-sign values as inert plain text without recursive expansion', () => {
    const value = '<img src=x onerror=alert(1)> $& {{company}}';
    expect(resolveTemplate('Hello {{first_name}}', { first_name: value })).toBe(`Hello ${value}`);
  });
});
