/**
 * Workspace Instructions — AGENTS.md / instructions.md injection.
 *
 * Inspired by OpenClaw's AGENTS.md / SOUL.md workspace pattern.
 * Reads project-specific instruction files from the workspace root
 * and injects them into the system prompt.
 */

import * as vscode from 'vscode';

/** Files to look for, in priority order. First found wins. */
const INSTRUCTION_FILES = [
  '.shumilek/AGENTS.md',
  '.shumilek/instructions.md',
  'AGENTS.md',
  '.shumilek/SOUL.md'
];

let logFn: ((msg: string) => void) | undefined;

export function setWorkspaceInstructionsLogger(fn: (msg: string) => void): void {
  logFn = fn;
}

/**
 * Scan workspace for instruction files and return their content.
 * Returns empty string if no instruction file found.
 * Content is truncated to `maxChars` to prevent prompt bloat.
 */
export async function loadWorkspaceInstructions(maxChars: number = 4000): Promise<string> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return '';

  const root = folders[0].uri;

  for (const relPath of INSTRUCTION_FILES) {
    const fileUri = vscode.Uri.joinPath(root, ...relPath.split('/'));
    try {
      const stat = await vscode.workspace.fs.stat(fileUri);
      if (stat.type !== vscode.FileType.File) continue;
      // Skip very large files
      if (stat.size > 50_000) {
        logFn?.(`[WorkspaceInstructions] ${relPath} too large (${stat.size} bytes), skipping`);
        continue;
      }
      const raw = await vscode.workspace.fs.readFile(fileUri);
      const content = Buffer.from(raw).toString('utf8').trim();
      if (!content) continue;

      const truncated = content.length > maxChars
        ? content.slice(0, maxChars) + '\n...[zkráceno]'
        : content;

      logFn?.(`[WorkspaceInstructions] Loaded ${relPath} (${content.length} chars)`);
      return `\n\n[WORKSPACE INSTRUKCE z ${relPath}]\n${truncated}`;
    } catch {
      // File doesn't exist, try next
      continue;
    }
  }

  logFn?.('[WorkspaceInstructions] No instruction file found');
  return '';
}

/**
 * Get the relative path of the loaded instruction file (for status display).
 */
export async function getInstructionFilePath(): Promise<string | null> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;

  const root = folders[0].uri;
  for (const relPath of INSTRUCTION_FILES) {
    const fileUri = vscode.Uri.joinPath(root, ...relPath.split('/'));
    try {
      const stat = await vscode.workspace.fs.stat(fileUri);
      if (stat.type === vscode.FileType.File) return relPath;
    } catch {
      continue;
    }
  }
  return null;
}
