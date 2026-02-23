const TEMPLATE_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export type TemplateResolver = (path: string) => unknown;

export function resolveTemplates(input: unknown, resolver: TemplateResolver): unknown {
  if (typeof input === 'string') {
    return resolveString(input, resolver);
  }
  if (Array.isArray(input)) {
    return input.map(item => resolveTemplates(item, resolver));
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = resolveTemplates(value, resolver);
    }
    return out;
  }
  return input;
}

export function getPathValue(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let current: unknown = root;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveString(value: string, resolver: TemplateResolver): string {
  return value.replace(TEMPLATE_RE, (_match, path) => {
    const resolved = resolver(path);
    if (resolved === undefined || resolved === null) return '';
    if (typeof resolved === 'string') return resolved;
    if (typeof resolved === 'number' || typeof resolved === 'boolean') {
      return String(resolved);
    }
    return JSON.stringify(resolved);
  });
}
