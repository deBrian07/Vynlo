const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const VARIABLE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export function getTemplateVariables(content: string): string[] {
  const variables = new Set<string>();
  const remainder = content.replace(PLACEHOLDER, (_match, raw: string) => {
    const name = raw.trim();
    if (!VARIABLE.test(name)) throw new Error('Use variable names such as {{first_name}}.');
    variables.add(name);
    return '';
  });
  if (remainder.includes('{{') || remainder.includes('}}'))
    throw new Error('A template variable is missing its opening or closing braces.');
  return [...variables];
}

/** Returns plain text, never HTML. The Gmail adapter owns safe text insertion. */
export function resolveTemplate(content: string, values: Record<string, string>): string {
  const variables = getTemplateVariables(content);
  const missing = variables.filter(
    (name) =>
      !Object.hasOwn(values, name) || typeof values[name] !== 'string' || !values[name].trim(),
  );
  if (missing.length) throw new Error(`Enter a value for: ${missing.join(', ')}.`);
  return content.replace(PLACEHOLDER, (_match, raw: string) => values[raw.trim()]!);
}
