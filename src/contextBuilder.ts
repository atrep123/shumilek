import * as vscode from 'vscode';
import * as path from 'path';
import { workspaceIndexer, ProjectMap } from './workspace';
import { serializeRange, serializeDiagnosticSeverity, serializeLocationInfo } from './lspSerializer';
import { isBinaryExtension, isProbablyBinary } from './fileUtils';
import { splitLines } from './diffUtils';

// ── constants ────────────────────────────────────────────────
export const DEFAULT_EXCLUDE_GLOB = '**/{node_modules,.git,dist,build,.next,__pycache__,.venv,venv,target,bin,obj,.idea,.vscode,coverage,.nyc_output}/**';
export const DEFAULT_MAX_EDITOR_FILES = 6;
export const DEFAULT_MAX_EDITOR_FILE_BYTES = 24 * 1024;
export const DEFAULT_MAX_EDITOR_TOTAL_BYTES = 120 * 1024;
export const DEFAULT_MAX_WARM_FILES = 4;
export const DEFAULT_MAX_WARM_FILE_BYTES = 12 * 1024;
export const DEFAULT_MAX_WARM_FALLBACK_RESULTS = 8;
export const DEFAULT_MAX_LSP_DIAGNOSTICS = 20;
export const DEFAULT_MAX_LSP_REFERENCES = 20;
export const DEFAULT_MAX_DIFF_BYTES = 128 * 1024;
export const DEFAULT_MAX_DIFF_LINES = 200;

// ── pure functions ───────────────────────────────────────────

export function truncateTextByBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return { text, truncated: false };
  }
  let end = Math.min(text.length, maxBytes);
  let slice = text.slice(0, end);
  while (Buffer.byteLength(slice, 'utf8') > maxBytes && end > 0) {
    end--;
    slice = text.slice(0, end);
  }
  return { text: slice, truncated: true };
}

export function extractImportPaths(text: string): string[] {
  const paths = new Set<string>();
  const importRegex = /from\s+['"]([^'"]+)['"]/g;
  const requireRegex = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(text)) !== null) {
    if (match[1]) paths.add(match[1]);
  }
  while ((match = requireRegex.exec(text)) !== null) {
    if (match[1]) paths.add(match[1]);
  }
  return Array.from(paths);
}

export function buildSimpleDiff(
  oldText: string,
  newText: string,
  maxLines: number
): { diff: string; truncated: boolean } {
  if (oldText === newText) return { diff: '', truncated: false };
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  const context = 2;
  const contextStart = Math.max(0, start - context);
  const contextEndOld = Math.min(oldLines.length - 1, oldEnd + context);
  const contextEndNew = Math.min(newLines.length - 1, newEnd + context);
  const hunkHeader = `@@ -${contextStart + 1},${contextEndOld - contextStart + 1} +${contextStart + 1},${contextEndNew - contextStart + 1} @@`;
  const lines: string[] = [hunkHeader];

  for (let i = contextStart; i < start; i++) {
    lines.push(` ${oldLines[i] ?? ''}`);
  }
  for (let i = start; i <= oldEnd; i++) {
    if (i < 0 || i >= oldLines.length) break;
    lines.push(`-${oldLines[i]}`);
  }
  for (let i = start; i <= newEnd; i++) {
    if (i < 0 || i >= newLines.length) break;
    lines.push(`+${newLines[i]}`);
  }
  for (let i = oldEnd + 1; i <= contextEndOld; i++) {
    if (i < 0 || i >= oldLines.length) break;
    lines.push(` ${oldLines[i] ?? ''}`);
  }

  let truncated = false;
  if (lines.length > maxLines) {
    truncated = true;
    lines.length = maxLines;
    lines.push('... truncated');
  }
  return { diff: lines.join('\n'), truncated };
}

export function isTestFileName(name: string): boolean {
  return /\.test\./i.test(name) || /\.spec\./i.test(name);
}

// ── shared utility functions (vscode-dependent, used broadly) ─

export function isWithinWorkspace(uri: vscode.Uri): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return false;
  const target = path.resolve(uri.fsPath);
  return folders.some(folder => {
    const root = path.resolve(folder.uri.fsPath);
    return target === root || target.startsWith(root + path.sep);
  });
}

export function isFileNotFoundError(err: unknown): boolean {
  if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') return true;
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code?: string }).code === 'FileNotFound';
  }
  return false;
}

export function getRelativePathForWorkspace(uri: vscode.Uri): string {
  const folders = vscode.workspace.workspaceFolders;
  const includeRoot = Boolean(folders && folders.length > 1);
  return vscode.workspace.asRelativePath(uri, includeRoot);
}

export function getActiveWorkspaceFileUri(): vscode.Uri | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const uri = editor.document.uri;
  if (!isWithinWorkspace(uri)) return undefined;
  return uri;
}

export function getOpenTextDocuments(): vscode.TextDocument[] {
  const seen = new Set<string>();
  const docs: vscode.TextDocument[] = [];
  const active = vscode.window.activeTextEditor?.document;
  if (active && !seen.has(active.uri.toString())) {
    seen.add(active.uri.toString());
    docs.push(active);
  }
  for (const editor of vscode.window.visibleTextEditors) {
    const doc = editor.document;
    const key = doc.uri.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    docs.push(doc);
  }
  return docs;
}

// ── context-specific functions ───────────────────────────────

export async function readFileFromDisk(
  uri: vscode.Uri,
  maxBytes: number
): Promise<{ text?: string; size?: number; error?: string; binary?: boolean }> {
  if (isBinaryExtension(uri.fsPath)) {
    return { error: 'binary file extension', binary: true };
  }
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > maxBytes) {
      return { error: `file too large (${stat.size} bytes)`, size: stat.size };
    }
    const buffer = await vscode.workspace.fs.readFile(uri);
    if (isProbablyBinary(buffer)) {
      return { error: 'binary file content', binary: true, size: buffer.length };
    }
    const text = new TextDecoder().decode(buffer);
    return { text, size: buffer.length };
  } catch (err) {
    if (isFileNotFoundError(err)) {
      return { error: 'file not found' };
    }
    return { error: `read error: ${String(err)}` };
  }
}

export async function resolveImportToUri(
  baseUri: vscode.Uri,
  importPath: string
): Promise<vscode.Uri | undefined> {
  if (!importPath.startsWith('.')) return undefined;
  const baseDir = vscode.Uri.joinPath(baseUri, '..');
  const candidateBase = vscode.Uri.joinPath(baseDir, importPath);
  const candidates = [
    candidateBase,
    vscode.Uri.file(`${candidateBase.fsPath}.ts`),
    vscode.Uri.file(`${candidateBase.fsPath}.tsx`),
    vscode.Uri.file(`${candidateBase.fsPath}.js`),
    vscode.Uri.file(`${candidateBase.fsPath}.json`),
    vscode.Uri.joinPath(candidateBase, 'index.ts'),
    vscode.Uri.joinPath(candidateBase, 'index.tsx'),
    vscode.Uri.joinPath(candidateBase, 'index.js')
  ];
  for (const uri of candidates) {
    try {
      await vscode.workspace.fs.stat(uri);
      if (isWithinWorkspace(uri)) return uri;
    } catch {
      // ignore
    }
  }
  return undefined;
}

export async function findRelatedTestFiles(doc: vscode.TextDocument, maxResults: number): Promise<vscode.Uri[]> {
  const baseName = path.parse(doc.uri.fsPath).name;
  const index = workspaceIndexer.getIndex();
  const results: vscode.Uri[] = [];
  if (index) {
    for (const file of index.files) {
      if (!isTestFileName(file.name)) continue;
      if (!file.name.toLowerCase().includes(baseName.toLowerCase())) continue;
      results.push(vscode.Uri.file(file.path));
      if (results.length >= maxResults) break;
    }
  }
  return results;
}

export async function findFallbackRelatedFiles(
  doc: vscode.TextDocument,
  maxResults: number
): Promise<vscode.Uri[]> {
  const baseName = path.parse(doc.uri.fsPath).name;
  const patterns = [
    `**/*${baseName}.test.*`,
    `**/*${baseName}.spec.*`,
    `**/${baseName}.*`,
    `**/*${baseName}*.*`
  ];
  const results: vscode.Uri[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const found = await vscode.workspace.findFiles(pattern, DEFAULT_EXCLUDE_GLOB, maxResults);
    for (const uri of found) {
      if (!isWithinWorkspace(uri)) continue;
      if (uri.fsPath === doc.uri.fsPath) continue;
      if (seen.has(uri.fsPath)) continue;
      seen.add(uri.fsPath);
      results.push(uri);
      if (results.length >= maxResults) return results;
    }
  }
  return results;
}

export async function buildWarmContext(doc: vscode.TextDocument): Promise<string[]> {
  const lines: string[] = [];
  const rawText = doc.getText();
  const importPaths = extractImportPaths(rawText).slice(0, DEFAULT_MAX_WARM_FILES);
  const importUris: vscode.Uri[] = [];
  for (const imp of importPaths) {
    const uri = await resolveImportToUri(doc.uri, imp);
    if (uri) importUris.push(uri);
  }
  const testUris = await findRelatedTestFiles(doc, 2);
  let relatedUris = [...importUris, ...testUris].slice(0, DEFAULT_MAX_WARM_FILES);
  if (relatedUris.length === 0) {
    const fallback = await findFallbackRelatedFiles(doc, DEFAULT_MAX_WARM_FALLBACK_RESULTS);
    relatedUris = fallback.slice(0, DEFAULT_MAX_WARM_FILES);
  }

  if (relatedUris.length === 0) {
    lines.push('WARM_CONTEXT: none');
    return lines;
  }

  lines.push('WARM_CONTEXT: related files');
  for (const uri of relatedUris) {
    const label = getRelativePathForWorkspace(uri);
    const readResult = await readFileFromDisk(uri, DEFAULT_MAX_WARM_FILE_BYTES);
    if (readResult.text === undefined) {
      lines.push(`- ${label}: ${readResult.error ?? 'unavailable'}`);
      continue;
    }
    const truncated = truncateTextByBytes(readResult.text, DEFAULT_MAX_WARM_FILE_BYTES);
    lines.push(`FILE: ${label}`);
    lines.push('```');
    lines.push(truncated.text);
    lines.push('```');
    if (truncated.truncated) lines.push('NOTE: truncated');
  }

  return lines;
}

export async function buildLspContext(doc: vscode.TextDocument): Promise<string[]> {
  const lines: string[] = [];
  const editor = vscode.window.activeTextEditor;
  if (!editor) return lines;
  const position = editor.selection.active;
  const diagnostics = vscode.languages.getDiagnostics(doc.uri).slice(0, DEFAULT_MAX_LSP_DIAGNOSTICS);
  if (diagnostics.length > 0) {
    lines.push('LSP_DIAGNOSTICS:');
    for (const diag of diagnostics) {
      const range = serializeRange(diag.range);
      lines.push(`- ${serializeDiagnosticSeverity(diag.severity)}: ${diag.message} (${range.startLine}:${range.startCharacter})`);
    }
  }

  const defs = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink> | vscode.Location | undefined>(
    'vscode.executeDefinitionProvider',
    doc.uri,
    position
  );
  const defList = Array.isArray(defs) ? defs : (defs ? [defs] : []);
  if (defList.length > 0) {
    lines.push('LSP_DEFINITION:');
    for (const def of defList.slice(0, 3)) {
      const info = serializeLocationInfo(def, getRelativePathForWorkspace);
      lines.push(`- ${info.path}:${info.range.startLine}:${info.range.startCharacter}`);
    }
  }

  const refs = await vscode.commands.executeCommand<vscode.Location[]>(
    'vscode.executeReferenceProvider',
    doc.uri,
    position,
    { includeDeclaration: true }
  );
  const refList = (refs ?? []).slice(0, DEFAULT_MAX_LSP_REFERENCES);
  if (refList.length > 0) {
    lines.push(`LSP_REFERENCES: ${refList.length}`);
    for (const ref of refList.slice(0, 5)) {
      const info = serializeLocationInfo(ref, getRelativePathForWorkspace);
      lines.push(`- ${info.path}:${info.range.startLine}:${info.range.startCharacter}`);
    }
  }

  return lines;
}

export function buildColdContext(includeMap: boolean, preferredUri?: vscode.Uri): string[] {
  if (!includeMap) return ['COLD_CONTEXT: skipped'];
  const folder = preferredUri ? vscode.workspace.getWorkspaceFolder(preferredUri) : undefined;
  const map = folder
    ? workspaceIndexer.getProjectMapForFolder(folder) ?? workspaceIndexer.getProjectMap()
    : workspaceIndexer.getProjectMap();
  if (!map) return ['COLD_CONTEXT: no project map'];
  const lines: string[] = [];
  lines.push('COLD_CONTEXT: project map');
  lines.push('TREE:');
  lines.push(map.tree ? map.tree : '- (empty)');
  if (map.keyFiles.length > 0) {
    lines.push('KEY_FILES:');
    for (const file of map.keyFiles.slice(0, 20)) {
      lines.push(`- ${file}`);
    }
  }
  return lines;
}

export async function buildEditorContext(
  prompt: string,
  context: vscode.ExtensionContext,
  workspaceIndexEnabled: boolean,
  ensureProjectMapFn: (ctx: vscode.ExtensionContext, reason: string, uri?: vscode.Uri, force?: boolean) => Promise<ProjectMap | null>,
  preferredMapUri?: vscode.Uri
): Promise<string> {
  const lines: string[] = [];
  const activeUri = getActiveWorkspaceFileUri();
  const includeMap = !activeUri || /(map|overview|structure|arch|projekt|repo)/i.test(prompt);
  lines.push('EDITOR_CONTEXT');
  lines.push('CONTEXT_ZONES: hot, warm, cold');
  lines.push(`active_file: ${activeUri ? getRelativePathForWorkspace(activeUri) : 'none'}`);

  const openDocs = getOpenTextDocuments().slice(0, DEFAULT_MAX_EDITOR_FILES);
  lines.push(`open_files: ${openDocs.length}`);
  let remainingBytes = DEFAULT_MAX_EDITOR_TOTAL_BYTES;

  for (const doc of openDocs) {
    const pathLabel = isWithinWorkspace(doc.uri)
      ? getRelativePathForWorkspace(doc.uri)
      : doc.uri.fsPath;
    lines.push(`- ${pathLabel} (lang=${doc.languageId}, lines=${doc.lineCount}, dirty=${doc.isDirty})`);
  }

  for (const doc of openDocs) {
    if (remainingBytes <= 0) break;
    const pathLabel = isWithinWorkspace(doc.uri)
      ? getRelativePathForWorkspace(doc.uri)
      : doc.uri.fsPath;
    const rawText = doc.getText();
    const maxBytes = Math.min(DEFAULT_MAX_EDITOR_FILE_BYTES, remainingBytes);
    const truncated = truncateTextByBytes(rawText, maxBytes);
    remainingBytes -= Buffer.byteLength(truncated.text, 'utf8');

    lines.push(`FILE: ${pathLabel}`);
    lines.push('```');
    lines.push(truncated.text);
    lines.push('```');
    if (truncated.truncated) {
      lines.push('NOTE: file content truncated');
    }

    if (doc.isDirty && doc.uri.scheme === 'file') {
      const diskResult = await readFileFromDisk(doc.uri, DEFAULT_MAX_DIFF_BYTES);
      if (diskResult.text !== undefined) {
        const diff = buildSimpleDiff(diskResult.text, rawText, DEFAULT_MAX_DIFF_LINES);
        if (diff.diff) {
          lines.push(`DIFF: ${pathLabel}`);
          lines.push('```');
          lines.push(diff.diff);
          lines.push('```');
          if (diff.truncated) {
            lines.push('NOTE: diff truncated');
          }
        }
      } else {
        lines.push(`DIFF: ${pathLabel}`);
        lines.push('```');
        lines.push('+ (no saved version)');
        lines.push('```');
      }
    }
  }

  if (activeUri) {
    const activeDoc = openDocs.find(doc => doc.uri.fsPath === activeUri.fsPath) ?? await vscode.workspace.openTextDocument(activeUri);
    lines.push(...await buildWarmContext(activeDoc));
    lines.push(...await buildLspContext(activeDoc));
  } else {
    lines.push('WARM_CONTEXT: no active file');
  }
  if (includeMap && workspaceIndexEnabled && !workspaceIndexer.getProjectMap()) {
    await ensureProjectMapFn(context, 'on-demand', preferredMapUri, true);
  }
  lines.push(...buildColdContext(includeMap, activeUri));

  return lines.join('\n');
}
