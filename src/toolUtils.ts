// ============================================================
// TOOL UTILITIES — pure helpers for tool/editor-first mode
// ============================================================

import { ToolSessionState } from './validationPipeline';

// ---- Interfaces ----

export interface ToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  tool: string;
  message?: string;
  data?: unknown;
  approved?: boolean;
}

export interface ToolCallOptions {
  forceJson?: boolean;
  systemPromptOverride?: string;
  primaryModel?: string;
  fallbackModel?: string;
}

export interface EditorPlan {
  answer?: string;
  actions?: ToolCall[];
  notes?: string[];
}

// ---- Pure functions ----

export function buildToolOnlyPrompt(requireMutation: boolean): string {
  const rules = [
    'Jsi vykonavac nastroju.',
    'Odpovidej pouze JSONem bez markdownu.',
    'Format: {"name":"<tool>","arguments":{...}} nebo pole takovych objektu.',
    requireMutation
      ? 'Musis provest zmenu souboru (write_file/replace_lines).'
      : 'Musis pouzit alespon jeden tool_call.'
  ];
  const tools = [
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
    'replace_lines',
    'apply_patch',
    'write_file',
    'pick_save_path',
    'route_file',
    'rename_file',
    'delete_file',
    'run_terminal_command',
    'fetch_webpage'
  ];
  return [...rules, `Dostupne nastroje: ${tools.join(', ')}`].join('\n');
}

export function buildEditorFirstInstructions(): string {
  return [
    'EDITOR-FIRST MODE:',
    'Return a single JSON object only (no markdown, no tool_call tags).',
    'Schema:',
    '{"answer":"...", "actions":[{"name":"replace_lines","arguments":{"path":"...","startLine":1,"endLine":1,"text":"...","expected":"..."}}]}',
    'Prefer patch-first edits when possible.',
    'Actions supported: apply_patch, write_file, replace_lines, rename_file, delete_file.',
    'apply_patch expects unified diff in arguments.diff.',
    'Use 1-based line numbers for replace_lines.',
    'If you are unsure about path, omit it and provide suggestedName/extension for write_file.',
    'No extra keys are required. Do not include analysis or commentary.'
  ].join('\n');
}

export function sanitizeEditorAnswer(answer: string, results: ToolResult[]): string {
  const trimmed = answer.trim();
  if (!trimmed) return '';
  const allOk = results.length > 0 && results.every(r => r.ok && r.approved !== false);
  const lines = trimmed.split(/\r\n|\n/);
  const filtered = lines.filter(line => {
    const lower = line.toLowerCase();
    if (/(kompil|kompilac|build|lint|test)/i.test(lower)) {
      return false;
    }
    if (allOk && /(nenalezen|neexistuje|soubor nebyl|error|fail|chyba)/i.test(lower)) {
      return false;
    }
    return true;
  });
  return filtered.join('\n').trim();
}

export function buildEditorStateMessage(session?: ToolSessionState): string | undefined {
  if (!session) return undefined;
  const parts: string[] = [];
  if (session.lastWritePath) {
    parts.push(`last_write_path: ${session.lastWritePath}`);
  }
  if (session.lastWriteAction) {
    parts.push(`last_write_action: ${session.lastWriteAction}`);
  }
  if (parts.length === 0) return undefined;
  return ['EDITOR_STATE:', ...parts, 'Use last_write_path if you need to edit the latest file.'].join('\n');
}

export function extractJsonPayload(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(text)) !== null) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    if (candidate.startsWith('{') || candidate.startsWith('[')) return candidate;
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  return undefined;
}

export function coerceEditorAction(raw: Record<string, unknown>): ToolCall | null {
  const name = typeof raw.name === 'string'
    ? raw.name
    : (typeof raw.tool === 'string'
      ? raw.tool
      : (typeof raw.type === 'string'
        ? raw.type
        : (typeof raw.action === 'string' ? raw.action : '')));
  if (!name) return null;
  const args = raw.arguments && typeof raw.arguments === 'object'
    ? raw.arguments as Record<string, unknown>
    : Object.fromEntries(Object.entries(raw).filter(([key]) => !['name', 'tool', 'type', 'action'].includes(key)));
  return { name, arguments: args };
}

export function parseEditorPlanResponse(text: string): { plan?: EditorPlan; error?: string } {
  const payload = extractJsonPayload(text);
  if (!payload) return { error: 'missing JSON payload' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    return { error: `invalid JSON: ${String(err)}` };
  }

  if (Array.isArray(parsed)) {
    const actions = parsed
      .map(item => (item && typeof item === 'object') ? coerceEditorAction(item as Record<string, unknown>) : null)
      .filter((item): item is ToolCall => Boolean(item));
    return { plan: { actions } };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { error: 'JSON must be object or array' };
  }

  const obj = parsed as Record<string, unknown>;
  const answer = typeof obj.answer === 'string'
    ? obj.answer
    : (typeof obj.response === 'string' ? obj.response : undefined);
  const notes = Array.isArray(obj.notes)
    ? obj.notes.filter(item => typeof item === 'string') as string[]
    : undefined;

  let rawActions: unknown = obj.actions;
  if (!Array.isArray(rawActions)) {
    rawActions = obj.toolCalls ?? obj.edits ?? obj.calls;
  }
  let actions: ToolCall[] | undefined;
  if (Array.isArray(rawActions)) {
    actions = rawActions
      .map(item => (item && typeof item === 'object') ? coerceEditorAction(item as Record<string, unknown>) : null)
      .filter((item): item is ToolCall => Boolean(item));
  } else if (obj.name || obj.tool || obj.type || obj.action) {
    const single = coerceEditorAction(obj);
    actions = single ? [single] : undefined;
  }

  return { plan: { answer, actions, notes } };
}

export function getToolRequirements(prompt: string): { requireToolCall: boolean; requireMutation: boolean } {
  const normalized = prompt.toLowerCase();
  const requireMutation = /(vytvo[rř]|ulo[zž]|zapi[sš]|napi[sš]|uprav|upravit|přepi[sš]|prepis|přidej|pridej|sma[zž]|smaz|smazat|prejmenuj|přejmenuj|rename|delete|write|edit|modify|create|replace|patch|apply_patch|write_file|replace_lines|run_terminal_command|spust|spustit|prikaz|přikaz|terminal)/.test(normalized);
  const requireToolCall = requireMutation || /(přečti|precti|zobraz|otevri|otevř|najdi|hledej|search|list_files|read_file|get_active_file|symboly|symbol|definice|definition|reference|references|diagnostik|diagnostics|lsp|get_symbols|get_workspace_symbols|get_definition|get_references|get_type_info|get_diagnostics|run_terminal_command|fetch|web|stahni|stáhni|url)/.test(normalized);
  return { requireToolCall, requireMutation };
}
