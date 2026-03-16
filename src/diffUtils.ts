// ============================================================
// Text line utilities
// ============================================================

export function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export function splitLines(text: string): string[] {
  if (!text) return [''];
  return text.split(/\r\n|\n/);
}

// ============================================================
// Unified diff types
// ============================================================

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface PatchFile {
  oldPath?: string;
  newPath?: string;
  hunks: PatchHunk[];
}

// ============================================================
// Unified diff parsing & application
// ============================================================

export function normalizePatchPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '/dev/null') return '';
  return trimmed.replace(/^a\//, '').replace(/^b\//, '');
}

export function parseUnifiedDiff(diffText: string): PatchFile[] {
  const lines = diffText.split(/\r\n|\n/);
  const files: PatchFile[] = [];
  let currentFile: PatchFile | null = null;
  let currentHunk: PatchHunk | null = null;

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      continue;
    }
    if (line.startsWith('--- ')) {
      if (currentFile) files.push(currentFile);
      currentFile = { oldPath: normalizePatchPath(line.slice(4)), newPath: undefined, hunks: [] };
      currentHunk = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (!currentFile) {
        currentFile = { oldPath: undefined, newPath: normalizePatchPath(line.slice(4)), hunks: [] };
      } else {
        currentFile.newPath = normalizePatchPath(line.slice(4));
      }
      continue;
    }
    if (line.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match || !currentFile) continue;
      const oldStart = parseInt(match[1], 10);
      const oldLines = match[2] ? parseInt(match[2], 10) : 1;
      const newStart = parseInt(match[3], 10);
      const newLines = match[4] ? parseInt(match[4], 10) : 1;
      currentHunk = { oldStart, oldLines, newStart, newLines, lines: [] };
      currentFile.hunks.push(currentHunk);
      continue;
    }
    if (currentHunk && (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line.startsWith('\\'))) {
      currentHunk.lines.push(line);
    }
  }
  if (currentFile) files.push(currentFile);
  return files;
}

export function applyUnifiedDiffToText(
  original: string,
  hunks: PatchHunk[]
): { text?: string; error?: string; appliedHunks: number; totalHunks: number } {
  const eol = detectEol(original);
  const originalLines = original.length === 0 ? [] : splitLines(original);
  const result: string[] = [];
  let cursor = 0;
  let appliedHunks = 0;
  const totalHunks = hunks.length;

  for (const hunk of hunks) {
    const oldStartIndex = Math.max(0, hunk.oldStart - 1);
    if (oldStartIndex < cursor || oldStartIndex > originalLines.length) {
      return { error: 'hunk start out of range', appliedHunks, totalHunks };
    }
    result.push(...originalLines.slice(cursor, oldStartIndex));
    let index = oldStartIndex;

    for (const line of hunk.lines) {
      if (!line) continue;
      const prefix = line[0];
      if (prefix === '\\') continue;
      const content = line.slice(1);
      if (prefix === ' ') {
        if (originalLines[index] !== content) {
          return { error: 'context mismatch', appliedHunks, totalHunks };
        }
        result.push(content);
        index++;
      } else if (prefix === '-') {
        if (originalLines[index] !== content) {
          return { error: 'delete mismatch', appliedHunks, totalHunks };
        }
        index++;
      } else if (prefix === '+') {
        result.push(content);
      }
    }
    cursor = index;
    appliedHunks++;
  }

  result.push(...originalLines.slice(cursor));
  return { text: result.join(eol), appliedHunks, totalHunks };
}
