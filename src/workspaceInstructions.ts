/**
 * Workspace Instructions — AGENTS.md / instructions.md injection.
 *
 * Inspired by OpenClaw's AGENTS.md / SOUL.md workspace pattern.
 * Reads project-specific instruction files from the workspace root
 * and injects them into the system prompt.
 */

import * as vscode from 'vscode';

/** Files to look for, in priority order. */
const INSTRUCTION_FILES = [
  '.shumilek/AGENTS.md',
  '.shumilek/instructions.md',
  'AGENTS.md',
  '.shumilek/SOUL.md'
];

const MAX_FILE_BYTES = 50_000;

export interface WorkspaceInstructionSource {
  path: string;
  originalChars: number;
  includedChars: number;
  truncated: boolean;
}

export interface WorkspaceInstructionBundle {
  text: string;
  files: WorkspaceInstructionSource[];
}

let logFn: ((msg: string) => void) | undefined;

export function setWorkspaceInstructionsLogger(fn: (msg: string) => void): void {
  logFn = fn;
}

async function loadInstructionCandidates(): Promise<Array<{ path: string; content: string; size: number }>> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return [];

  const root = folders[0].uri;
  const entries: Array<{ path: string; content: string; size: number }> = [];

  for (const relPath of INSTRUCTION_FILES) {
    const fileUri = vscode.Uri.joinPath(root, ...relPath.split('/'));
    try {
      const stat = await vscode.workspace.fs.stat(fileUri);
      if (stat.type !== vscode.FileType.File) continue;
      if (stat.size > MAX_FILE_BYTES) {
        logFn?.(`[WorkspaceInstructions] ${relPath} too large (${stat.size} bytes), skipping`);
        continue;
      }

      const raw = await vscode.workspace.fs.readFile(fileUri);
      const content = Buffer.from(raw).toString('utf8').trim();
      if (!content) continue;
      entries.push({ path: relPath, content, size: stat.size });
    } catch {
      continue;
    }
  }

  return entries;
}

export async function loadWorkspaceInstructionBundle(maxChars: number = 4000): Promise<WorkspaceInstructionBundle> {
  const candidates = await loadInstructionCandidates();
  if (candidates.length === 0) {
    logFn?.('[WorkspaceInstructions] No instruction file found');
    return { text: '', files: [] };
  }

  let remaining = Math.max(0, maxChars);
  const sections: string[] = [];
  const files: WorkspaceInstructionSource[] = [];

  for (const entry of candidates) {
    if (remaining <= 0) break;
    const sectionHeader = `[WORKSPACE INSTRUKCE z ${entry.path}]\n`;
    const headerCost = files.length === 0 ? sectionHeader.length : sectionHeader.length + 2;
    if (remaining <= headerCost) break;

    const availableForContent = remaining - headerCost;
    const needsTruncation = entry.content.length > availableForContent;
    let included = needsTruncation
      ? entry.content.slice(0, Math.max(0, availableForContent - '\n...[zkráceno]'.length)) + '\n...[zkráceno]'
      : entry.content;
    if (!included.trim()) continue;

    sections.push(`${files.length === 0 ? '' : '\n\n'}${sectionHeader}${included}`);
    files.push({
      path: entry.path,
      originalChars: entry.content.length,
      includedChars: included.length,
      truncated: needsTruncation
    });
    remaining -= headerCost + included.length;
    logFn?.(`[WorkspaceInstructions] Loaded ${entry.path} (${entry.content.length} chars${needsTruncation ? ', truncated' : ''})`);
  }

  if (files.length === 0) {
    logFn?.('[WorkspaceInstructions] Instruction files found but nothing fit within budget');
    return { text: '', files: [] };
  }

  return {
    text: `\n\n${sections.join('')}`,
    files
  };
}

/**
 * Scan workspace for instruction files and return their content.
 * Returns empty string if no instruction file found.
 * Content is truncated to `maxChars` to prevent prompt bloat.
 */
export async function loadWorkspaceInstructions(maxChars: number = 4000): Promise<string> {
  const bundle = await loadWorkspaceInstructionBundle(maxChars);
  return bundle.text;
}

/**
 * Get the relative path of the loaded instruction file (for status display).
 */
export async function getInstructionFilePath(): Promise<string | null> {
  const candidates = await loadInstructionCandidates();
  return candidates[0]?.path ?? null;
}

export async function getInstructionFilePaths(): Promise<string[]> {
  const candidates = await loadInstructionCandidates();
  return candidates.map(entry => entry.path);
}
