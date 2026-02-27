export interface ParsedToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ParseToolCallsResult {
  calls: ParsedToolCall[];
  remainingText: string;
  errors: string[];
}

export type ToolPermissionScope = 'read' | 'edit' | 'commands' | 'browser' | 'mcp';

const TOOL_CALL_REGEX = /<tool_call>([\s\S]*?)<\/tool_call>/g;

const READ_TOOL_NAMES = new Set<string>([
  'list_files',
  'read_file',
  'get_active_file',
  'search_in_files',
  'get_symbols',
  'get_workspace_symbols',
  'get_definition',
  'get_references',
  'get_type_info',
  'get_diagnostics',
  'pick_save_path',
  'route_file'
]);

const EDIT_TOOL_NAMES = new Set<string>([
  'apply_patch',
  'replace_lines',
  'write_file',
  'rename_file',
  'delete_file'
]);

export function resolveToolPermissionScope(name: string): ToolPermissionScope {
  if (EDIT_TOOL_NAMES.has(name)) return 'edit';
  if (READ_TOOL_NAMES.has(name)) return 'read';
  if (name.startsWith('browser_')) return 'browser';
  if (name.startsWith('mcp_')) return 'mcp';
  return 'commands';
}

export function parseToolCalls(text: string): ParseToolCallsResult {
  const calls: ParsedToolCall[] = [];
  const errors: string[] = [];
  let match: RegExpExecArray | null;
  let sawTaggedCallBlock = false;

  TOOL_CALL_REGEX.lastIndex = 0;
  while ((match = TOOL_CALL_REGEX.exec(text)) !== null) {
    sawTaggedCallBlock = true;
    const raw = match[1]?.trim();
    if (!raw) {
      errors.push('Empty tool_call payload');
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.name !== 'string') {
        errors.push('Missing tool name');
        continue;
      }
      const args = parsed.arguments && typeof parsed.arguments === 'object'
        ? parsed.arguments
        : undefined;
      calls.push({ name: parsed.name, arguments: args });
    } catch (err) {
      errors.push(`Invalid JSON: ${String(err)}`);
    }
  }

  if (calls.length === 0) {
    const candidates: string[] = [];
    const fenceRegex = /```(\w+)?\s*([\s\S]*?)```/gi;
    let fenceMatch: RegExpExecArray | null;
    while ((fenceMatch = fenceRegex.exec(text)) !== null) {
      const lang = (fenceMatch[1] || '').toLowerCase();
      if (lang && lang !== 'json') continue;
      const payload = fenceMatch[2]?.trim();
      if (!payload) continue;
      if (!payload.startsWith('{') && !payload.startsWith('[')) continue;
      candidates.push(payload);
    }
    const trimmed = text.trim();
    if (candidates.length === 0 && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
      candidates.push(trimmed);
    }

    const pushParsed = (parsed: unknown) => {
      if (!parsed) return;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const name = (item as { name?: unknown }).name;
        if (typeof name !== 'string') continue;
        const args = (item as { arguments?: unknown }).arguments;
        calls.push({
          name,
          arguments: args && typeof args === 'object' ? (args as Record<string, unknown>) : undefined
        });
      }
    };

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        pushParsed(parsed);
      } catch (err) {
        errors.push(`Invalid JSON: ${String(err)}`);
      }
    }
  }

  TOOL_CALL_REGEX.lastIndex = 0;
  let remainingText = text.replace(TOOL_CALL_REGEX, '').trim();
  if (!sawTaggedCallBlock && calls.length > 0) {
    // Fallback JSON mode has no tags; treat as pure tooling response.
    remainingText = '';
  }

  return { calls, remainingText, errors };
}
