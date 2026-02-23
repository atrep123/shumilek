import * as vscode from 'vscode';
import { workspaceIndexer } from './workspace';
import type { ContextProviderName } from './types';

type ProviderResult = {
  name: ContextProviderName;
  content: string;
};

type ProviderContext = {
  prompt: string;
  maxChars: number;
  workspaceIndexEnabled: boolean;
};

type ProviderFn = (ctx: ProviderContext) => Promise<ProviderResult | null>;

const CHARS_PER_TOKEN = 4;

function toCharBudget(tokenBudget: number): number {
  const safeTokens = Number.isFinite(tokenBudget) ? Math.max(256, Math.floor(tokenBudget)) : 1024;
  return safeTokens * CHARS_PER_TOKEN;
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 40))}\n...<snip>...\n`;
}

async function workspaceProvider(ctx: ProviderContext): Promise<ProviderResult | null> {
  if (!ctx.workspaceIndexEnabled) return null;
  const index = workspaceIndexer.getIndex();
  if (!index) return null;
  const content = [
    'WORKSPACE_SUMMARY:',
    index.summary,
    '',
    'WORKSPACE_STRUCTURE:',
    index.structure
  ].join('\n');
  return { name: 'workspace', content: truncateText(content, ctx.maxChars) };
}

async function fileProvider(ctx: ProviderContext): Promise<ProviderResult | null> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const doc = editor.document;
  const rel = vscode.workspace.asRelativePath(doc.uri);
  const content = [
    `ACTIVE_FILE: ${rel}`,
    '```',
    truncateText(doc.getText(), Math.max(256, Math.floor(ctx.maxChars * 0.85))),
    '```'
  ].join('\n');
  return { name: 'file', content };
}

async function codeProvider(ctx: ProviderContext): Promise<ProviderResult | null> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) return null;
  const selected = editor.document.getText(editor.selection).trim();
  if (!selected) return null;
  return {
    name: 'code',
    content: ['SELECTED_CODE:', '```', truncateText(selected, ctx.maxChars), '```'].join('\n')
  };
}

async function diffProvider(ctx: ProviderContext): Promise<ProviderResult | null> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  if (!editor.document.isDirty) return null;
  return {
    name: 'diff',
    content: truncateText(
      `DIRTY_FILE: ${vscode.workspace.asRelativePath(editor.document.uri)}\nUnsaved changes detected in active document.`,
      ctx.maxChars
    )
  };
}

async function terminalProvider(_: ProviderContext): Promise<ProviderResult | null> {
  return null;
}

async function docsProvider(_: ProviderContext): Promise<ProviderResult | null> {
  return null;
}

async function webProvider(_: ProviderContext): Promise<ProviderResult | null> {
  return null;
}

const DEFAULT_PROVIDER_MAP: Record<ContextProviderName, ProviderFn> = {
  workspace: workspaceProvider,
  file: fileProvider,
  code: codeProvider,
  diff: diffProvider,
  terminal: terminalProvider,
  docs: docsProvider,
  web: webProvider
};

export const DEFAULT_CONTEXT_PROVIDERS: ContextProviderName[] = [
  'workspace',
  'file',
  'code',
  'diff',
  'terminal',
  'docs',
  'web'
];

export class ContextProviderRegistry {
  private readonly providers = new Map<ContextProviderName, ProviderFn>();

  constructor() {
    for (const [name, fn] of Object.entries(DEFAULT_PROVIDER_MAP) as Array<[ContextProviderName, ProviderFn]>) {
      this.providers.set(name, fn);
    }
  }

  register(name: ContextProviderName, fn: ProviderFn): void {
    this.providers.set(name, fn);
  }

  async collect(params: {
    prompt: string;
    enabled: ContextProviderName[];
    tokenBudget: number;
    workspaceIndexEnabled: boolean;
  }): Promise<string> {
    const lines: string[] = [];
    let remainingChars = toCharBudget(params.tokenBudget);
    const enabled = params.enabled.length > 0 ? params.enabled : DEFAULT_CONTEXT_PROVIDERS;

    for (const name of enabled) {
      if (remainingChars <= 120) break;
      const provider = this.providers.get(name);
      if (!provider) continue;
      const result = await provider({
        prompt: params.prompt,
        maxChars: Math.max(200, Math.floor(remainingChars / Math.max(1, enabled.length))),
        workspaceIndexEnabled: params.workspaceIndexEnabled
      });
      if (!result || !result.content.trim()) continue;
      const block = `[CONTEXT:${result.name}]\n${result.content.trim()}`;
      if (block.length > remainingChars) {
        const trimmed = truncateText(block, remainingChars);
        if (trimmed.trim()) lines.push(trimmed);
        remainingChars = 0;
        break;
      }
      lines.push(block);
      remainingChars -= block.length;
    }

    return lines.join('\n\n');
  }
}

