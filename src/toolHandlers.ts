import * as path from 'path';
import * as vscode from 'vscode';
import { exec } from 'child_process';

export interface ToolResultLike {
  ok: boolean;
  tool: string;
  message?: string;
  data?: unknown;
  approved?: boolean;
}

export interface AutoApproveLike {
  edit: boolean;
  commands: boolean;
}

export interface ToolSessionLike {
  hadMutations: boolean;
  mutationTools: string[];
  lastWritePath?: string;
  lastWriteAction?: 'created' | 'updated';
}

export interface ResolveWorkspaceUriResult {
  uri?: vscode.Uri;
  error?: string;
  conflicts?: string[];
}

export interface ReadFileForToolResult {
  text?: string;
  size?: number;
  binary?: boolean;
  hash?: string;
  error?: string;
}

export interface ToolPositionInfo {
  position?: vscode.Position;
  line?: number;
  character?: number;
  error?: string;
}

export interface PatchHunkLike {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface PatchFileLike {
  oldPath?: string;
  newPath?: string;
  hunks: PatchHunkLike[];
}

export interface MutationHandlerDeps {
  DEFAULT_MAX_READ_BYTES: number;
  DEFAULT_MAX_WRITE_BYTES: number;
  DEFAULT_MAX_LSP_RESULTS: number;
  DEFAULT_MAX_LIST_RESULTS: number;
  DEFAULT_MAX_READ_LINES: number;
  DEFAULT_MAX_SEARCH_RESULTS: number;
  DEFAULT_EXCLUDE_GLOB: string;
  BINARY_EXTENSIONS: Set<string>;
  lastReadHashes: Map<string, { hash: string; updatedAt: number }>;
  asString: (value: unknown) => string | undefined;
  clampNumber: (value: unknown, fallback: number, min: number, max: number) => number;
  getFirstStringArg: (args: Record<string, unknown>, keys: string[]) => string | undefined;
  resolveWorkspaceUri: (filePath: string, mustExist: boolean) => Promise<ResolveWorkspaceUriResult>;
  getActiveWorkspaceFileUri: () => vscode.Uri | undefined;
  readFileForTool: (uri: vscode.Uri, maxBytes: number) => Promise<ReadFileForToolResult>;
  getRelativePathForWorkspace: (uri: vscode.Uri) => string;
  getPositionFromArgs: (args: Record<string, unknown>, doc?: vscode.TextDocument) => ToolPositionInfo;
  resolveSymbolPosition: (uri: vscode.Uri, symbolName: string) => Promise<vscode.Position | undefined>;
  serializeLocationInfo: (location: vscode.Location | vscode.LocationLink) => { path: string; range: unknown };
  serializeRange: (range: vscode.Range) => unknown;
  serializeSymbolKind: (kind: vscode.SymbolKind) => string;
  renderHoverContents: (contents: vscode.Hover['contents']) => string[];
  serializeDiagnosticSeverity: (severity: vscode.DiagnosticSeverity) => string;
  detectEol: (text: string) => string;
  splitLines: (text: string) => string[];
  showDiffAndConfirm: (uri: vscode.Uri, newText: string, title: string) => Promise<boolean>;
  applyFileContent: (uri: vscode.Uri, newText: string) => Promise<boolean>;
  markToolMutation: (session: ToolSessionLike | undefined, toolName: string) => void;
  recordToolWrite: (session: ToolSessionLike | undefined, action: 'created' | 'updated', pathValue: string) => void;
  computeContentHash: (text: string) => string;
  getToolsAutoOpenAutoSaveSetting: () => boolean;
  getToolsAutoOpenOnWriteSetting: () => boolean;
  isInAutoSaveDir: (uri: vscode.Uri) => boolean;
  revealWrittenDocument: (uri: vscode.Uri) => Promise<void>;
  notifyToolWrite: (action: 'created' | 'updated', uri: vscode.Uri) => Promise<void>;
  parseUnifiedDiff: (diffText: string) => PatchFileLike[];
  applyUnifiedDiffToText: (
    original: string,
    hunks: PatchHunkLike[]
  ) => { text?: string; error?: string; appliedHunks: number; totalHunks: number };
  isBinaryExtension: (filePath: string) => boolean;
  normalizeExtension: (ext: string | undefined) => string;
  normalizeRouteText: (input: string) => string;
  tokenizeRouteText: (input: string) => string[];
  buildAutoFileName: (options: { title?: string; suggestedName?: string; extension?: string; content?: string }) => string;
  resolveAutoSaveTargetUri: (fileName: string) => Promise<{ uri?: vscode.Uri; error?: string }>;
  isSafeUrl: (raw: string) => Promise<{ safe: boolean; reason?: string }> | { safe: boolean; reason?: string };
  openExternalUrl: (url: string) => Promise<boolean>;
}

export async function handleBrowserOpenPageTool(
  name: string,
  args: Record<string, unknown>,
  deps: MutationHandlerDeps
): Promise<ToolResultLike> {
  const url = deps.asString(args.url);
  if (!url) return { ok: false, tool: name, message: 'url je povinne' };

  const urlCheck = await deps.isSafeUrl(url);
  if (!urlCheck.safe) {
    return { ok: false, tool: name, message: `URL blokována: ${urlCheck.reason}` };
  }

  const opened = await deps.openExternalUrl(url);
  return opened
    ? { ok: true, tool: name, message: `otevreno: ${url}`, data: { url } }
    : { ok: false, tool: name, message: `nepodarilo se otevrit: ${url}`, data: { url } };
}

export async function handleReplaceLinesTool(
  name: string,
  args: Record<string, unknown>,
  confirmEdits: boolean,
  autoApprove: AutoApproveLike,
  deps: MutationHandlerDeps,
  session?: ToolSessionLike
): Promise<ToolResultLike> {
  const filePath = deps.getFirstStringArg(args, ['path', 'file', 'filePath', 'filename']);
  const startLine = typeof args.startLine === 'number'
    ? args.startLine
    : (typeof args.start === 'number' ? args.start : NaN);
  const endLine = typeof args.endLine === 'number'
    ? args.endLine
    : (typeof args.end === 'number' ? args.end : NaN);
  const replacement = deps.getFirstStringArg(args, ['text', 'replacement', 'content', 'body', 'value']);
  const expected = deps.asString(args.expected);
  const autoOpenOnWrite = deps.getToolsAutoOpenOnWriteSetting();
  const autoOpenAutoSave = deps.getToolsAutoOpenAutoSaveSetting();

  if (replacement === undefined || !Number.isFinite(startLine) || !Number.isFinite(endLine)) {
    return { ok: false, tool: name, message: 'startLine, endLine, text jsou povinne' };
  }

  let uri: vscode.Uri | undefined;
  if (filePath) {
    const resolved = await deps.resolveWorkspaceUri(filePath, true);
    if (!resolved.uri) {
      return {
        ok: false,
        tool: name,
        message: resolved.error ?? 'soubor nenalezen nebo mimo workspace',
        data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
      };
    }
    uri = resolved.uri;
  } else {
    const activeUri = deps.getActiveWorkspaceFileUri();
    if (!activeUri) {
      return { ok: false, tool: name, message: 'path je povinny nebo otevri aktivni soubor' };
    }
    uri = activeUri;
  }

  const readResult = await deps.readFileForTool(uri, deps.DEFAULT_MAX_READ_BYTES);
  if (readResult.text === undefined) {
    return {
      ok: false,
      tool: name,
      message: readResult.error ?? 'soubor nelze precist',
      data: {
        sizeBytes: readResult.size,
        binary: readResult.binary ?? false
      }
    };
  }
  const lastHash = deps.lastReadHashes.get(uri.fsPath);
  if (!lastHash && readResult.hash) {
    deps.lastReadHashes.set(uri.fsPath, { hash: readResult.hash, updatedAt: Date.now() });
  } else if (readResult.hash && lastHash && lastHash.hash !== readResult.hash) {
    const currentLineCount = readResult.text ? readResult.text.split(/\r\n|\n/).length : undefined;
    return {
      ok: false,
      tool: name,
      message: 'soubor se zmenil od posledniho cteni; nacti ho znovu (read_file) a opakuj replace_lines',
      data: {
        path: deps.getRelativePathForWorkspace(uri),
        lastHash: lastHash.hash,
        lastReadAt: lastHash.updatedAt,
        currentHash: readResult.hash,
        currentSizeBytes: readResult.size,
        currentLineCount
      }
    };
  }

  const eol = deps.detectEol(readResult.text);
  const lines = deps.splitLines(readResult.text);
  const totalLines = lines.length;
  if (startLine < 1 || endLine < startLine || startLine > totalLines) {
    return { ok: false, tool: name, message: 'neplatny rozsah radku' };
  }

  const currentBlock = lines.slice(startLine - 1, endLine).join('\n');
  if (expected && expected.replace(/\r\n/g, '\n') !== currentBlock) {
    return {
      ok: false,
      tool: name,
      message: 'expected neodpovida aktualnimu obsahu',
      data: { current: currentBlock }
    };
  }

  const replacementLines = replacement.split(/\r\n|\n/);
  const newLines = [
    ...lines.slice(0, startLine - 1),
    ...replacementLines,
    ...lines.slice(endLine)
  ];
  const newText = newLines.join(eol);

  let approved = true;
  if (confirmEdits && !autoApprove.edit) {
    approved = await deps.showDiffAndConfirm(uri, newText, `Navrh zmen: ${vscode.workspace.asRelativePath(uri)}`);
  }
  if (!approved) {
    return { ok: true, tool: name, approved: false, message: 'zmena zamitnuta uzivatelem' };
  }

  // Re-verify file hash before write to close TOCTOU race window
  const preWriteRead = await deps.readFileForTool(uri, deps.DEFAULT_MAX_READ_BYTES);
  if (preWriteRead.hash && readResult.hash && preWriteRead.hash !== readResult.hash) {
    return {
      ok: false,
      tool: name,
      message: 'soubor se zmenil behem schvalovani; nacti ho znovu (read_file) a opakuj replace_lines'
    };
  }

  const applied = await deps.applyFileContent(uri, newText);
  if (applied) {
    const relativePath = deps.getRelativePathForWorkspace(uri);
    deps.markToolMutation(session, name);
    deps.recordToolWrite(session, 'updated', relativePath);
    deps.lastReadHashes.set(uri.fsPath, { hash: deps.computeContentHash(newText), updatedAt: Date.now() });
    const shouldOpenUpdated = autoOpenOnWrite || (autoOpenAutoSave && deps.isInAutoSaveDir(uri));
    if (shouldOpenUpdated) {
      await deps.revealWrittenDocument(uri);
    }
    await deps.notifyToolWrite('updated', uri);
  }
  return {
    ok: applied,
    tool: name,
    approved: applied,
    message: applied ? 'zmena aplikovana' : 'nepodarilo se aplikovat zmenu',
    data: applied ? { path: deps.getRelativePathForWorkspace(uri), action: 'updated' } : undefined
  };
}

export async function handleWriteFileTool(
  name: string,
  args: Record<string, unknown>,
  confirmEdits: boolean,
  autoApprove: AutoApproveLike,
  deps: MutationHandlerDeps,
  session?: ToolSessionLike
): Promise<ToolResultLike> {
  let filePath = deps.getFirstStringArg(args, ['path', 'file', 'filePath', 'filename']);
  const text = deps.getFirstStringArg(args, ['text', 'content', 'body', 'data', 'value']);
  const title = deps.asString(args.title);
  const suggestedNameRaw = deps.asString(args.suggestedName);
  const extensionRaw = deps.asString(args.extension);
  const autoOpenAutoSave = deps.getToolsAutoOpenAutoSaveSetting();
  const autoOpenOnWrite = deps.getToolsAutoOpenOnWriteSetting();
  const hadExplicitPath = Boolean(filePath);
  let autoSaveGenerated = false;
  if (text === undefined) {
    return { ok: false, tool: name, message: 'text je povinny' };
  }
  const textBytes = Buffer.byteLength(text, 'utf8');
  if (textBytes > deps.DEFAULT_MAX_WRITE_BYTES) {
    return {
      ok: false,
      tool: name,
      message: `obsah je moc velky (${textBytes} bytes), limit ${deps.DEFAULT_MAX_WRITE_BYTES}`,
      data: { sizeBytes: textBytes }
    };
  }

  let uri: vscode.Uri | undefined;
  if (filePath) {
    if (deps.isBinaryExtension(filePath)) {
      return { ok: false, tool: name, message: 'cesta vypada jako binarni soubor (extenze)' };
    }
    const resolved = await deps.resolveWorkspaceUri(filePath, false);
    if (!resolved.uri) {
      return {
        ok: false,
        tool: name,
        message: resolved.error ?? 'soubor mimo workspace',
        data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
      };
    }
    uri = resolved.uri;
  } else {
    const activeUri = deps.getActiveWorkspaceFileUri();
    if (activeUri) {
      if (deps.isBinaryExtension(activeUri.fsPath)) {
        return { ok: false, tool: name, message: 'aktivni soubor vypada jako binarni (extenze)' };
      }
      uri = activeUri;
      filePath = deps.getRelativePathForWorkspace(activeUri);
    } else {
      const fileName = deps.buildAutoFileName({
        title,
        suggestedName: suggestedNameRaw,
        extension: extensionRaw,
        content: text
      });
      const resolved = await deps.resolveAutoSaveTargetUri(fileName);
      if (!resolved.uri) {
        return { ok: false, tool: name, message: resolved.error ?? 'nelze vytvorit cestu' };
      }
      uri = resolved.uri;
      filePath = deps.getRelativePathForWorkspace(uri);
      autoSaveGenerated = true;
    }
  }

  let exists = true;
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    exists = false;
  }

  let approved = true;
  if (confirmEdits && !autoApprove.edit) {
    if (exists) {
      approved = await deps.showDiffAndConfirm(uri, text, `Navrh zmen: ${vscode.workspace.asRelativePath(uri)}`);
    } else {
      const previewDoc = await vscode.workspace.openTextDocument({ content: text });
      await vscode.window.showTextDocument(previewDoc, { preview: true });
      const choice = await vscode.window.showInformationMessage(
        `Vytvorit novy soubor ${vscode.workspace.asRelativePath(uri)}?`,
        { modal: true },
        'Vytvorit',
        'Zamitnout'
      );
      approved = choice === 'Vytvorit';
    }
  }

  if (!approved) {
    return { ok: true, tool: name, approved: false, message: 'zmena zamitnuta uzivatelem' };
  }

  if (exists) {
    const existing = await deps.readFileForTool(uri, deps.DEFAULT_MAX_WRITE_BYTES);
    if (existing.text === undefined) {
      return {
        ok: false,
        tool: name,
        message: existing.error ?? 'soubor nelze precist',
        data: {
          sizeBytes: existing.size,
          binary: existing.binary ?? false
        }
      };
    }
    const applied = await deps.applyFileContent(uri, text);
    if (applied) {
      const relativePath = deps.getRelativePathForWorkspace(uri);
      deps.markToolMutation(session, name);
      deps.recordToolWrite(session, 'updated', relativePath);
      deps.lastReadHashes.set(uri.fsPath, { hash: deps.computeContentHash(text), updatedAt: Date.now() });
      const shouldOpenUpdated = autoOpenOnWrite || (autoOpenAutoSave && deps.isInAutoSaveDir(uri));
      if (shouldOpenUpdated) {
        await deps.revealWrittenDocument(uri);
      }
      await deps.notifyToolWrite('updated', uri);
    }
    return {
      ok: applied,
      tool: name,
      approved: applied,
      message: applied ? 'soubor upraven' : 'nepodarilo se upravit soubor',
      data: applied ? { path: deps.getRelativePathForWorkspace(uri), action: 'updated' } : undefined
    };
  }

  const parent = vscode.Uri.file(path.dirname(uri.fsPath));
  try {
    await vscode.workspace.fs.createDirectory(parent);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
  } catch (ioErr: unknown) {
    return { ok: false, tool: name, message: `chyba zapisu: ${(ioErr as Error).message || String(ioErr)}` };
  }
  const shouldOpenCreated = autoOpenOnWrite || (autoOpenAutoSave && (autoSaveGenerated || deps.isInAutoSaveDir(uri)));
  if (shouldOpenCreated) {
    const opened = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(opened, { preview: false });
  }
  await deps.notifyToolWrite('created', uri);
  const createdPath = deps.getRelativePathForWorkspace(uri);
  deps.markToolMutation(session, name);
  deps.recordToolWrite(session, 'created', createdPath);
  deps.lastReadHashes.set(uri.fsPath, { hash: deps.computeContentHash(text), updatedAt: Date.now() });
  return {
    ok: true,
    tool: name,
    approved: true,
    message: 'soubor vytvoren',
    data: {
      path: createdPath,
      action: 'created',
      explicitPath: hadExplicitPath,
      autoSaveGenerated
    }
  };
}

// Blocked shell patterns that indicate dangerous operations.
// The approval gate already requires user confirmation, but these
// provide defense-in-depth against prompt-injection generated commands.
const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+(-[a-z]*f|-[a-z]*r|--force|--recursive)\b/i,
  /\brm\s+-rf\b/i,
  /\brmdir\s+\/s\b/i,
  /\b(curl|wget|invoke-webrequest)\b.*\|\s*(sh|bash|powershell|cmd)/i,
  /\b(mkfs|dd\s+if=|format\s+[a-z]:)/i,
  /\b(\.[\/\\]|sh|bash|cmd|powershell)\s+<\s*\(/i,
  /\bchmod\s+[0-7]*777\b/i,
  /\b(shutdown|reboot|halt|init\s+[06])\b/i,
  /:\(\)\s*\{[^}]*:\s*\|\s*:.*&\s*\}\s*;/,   // fork bomb
];

export function isCommandBlocked(command: string): boolean {
  return BLOCKED_COMMAND_PATTERNS.some(p => p.test(command));
}

export async function handleRunTerminalCommandTool(
  name: string,
  args: Record<string, unknown>,
  deps: MutationHandlerDeps
): Promise<ToolResultLike> {
  // Approval is handled by the outer gate in runToolCall (scope: 'commands').
  // No per-handler approval check needed.
  const command = deps.asString(args.command);
  if (!command) return { ok: false, tool: name, message: 'command je povinny' };

  if (isCommandBlocked(command)) {
    return { ok: false, tool: name, message: 'prikaz blokovan bezpecnostni politikou' };
  }

  const timeoutMs = deps.clampNumber(args.timeoutMs, 30000, 1000, 120000);
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  return await new Promise((resolve) => {
    exec(command, { cwd, timeout: timeoutMs }, (error, stdout, stderr) => {
      const exitCode = error ? (error as any).code || 1 : 0;
      const succeeded = exitCode === 0;
      resolve({
        ok: succeeded,
        tool: name,
        approved: true,
        message: succeeded ? 'prikaz dokoncen uspesne' : `prikaz selhal (exit code ${exitCode})`,
        data: {
          stdout: stdout ? stdout.slice(0, 15000) : '',
          stderr: stderr ? stderr.slice(0, 15000) : '',
          exitCode,
          error: error ? error.message : undefined
        }
      });
    });
  });
}

export async function handleRenameFileTool(
  name: string,
  args: Record<string, unknown>,
  confirmEdits: boolean,
  autoApprove: AutoApproveLike,
  deps: MutationHandlerDeps,
  session?: ToolSessionLike
): Promise<ToolResultLike> {
  const fromPath = deps.asString(args.from);
  const toPath = deps.asString(args.to);
  if (!fromPath || !toPath) return { ok: false, tool: name, message: 'from a to jsou povinne' };
  const fromResolved = await deps.resolveWorkspaceUri(fromPath, true);
  const toResolved = await deps.resolveWorkspaceUri(toPath, false);
  if (!fromResolved.uri || !toResolved.uri) {
    return {
      ok: false,
      tool: name,
      message: fromResolved.error ?? toResolved.error ?? 'soubor mimo workspace nebo nenalezen',
      data: fromResolved.conflicts || toResolved.conflicts
        ? { conflicts: fromResolved.conflicts ?? toResolved.conflicts }
        : undefined
    };
  }
  const fromUri = fromResolved.uri;
  const toUri = toResolved.uri;

  let approved = true;
  if (confirmEdits && !autoApprove.edit) {
    const choice = await vscode.window.showInformationMessage(
      `Prejmenovat ${vscode.workspace.asRelativePath(fromUri)} na ${vscode.workspace.asRelativePath(toUri)}?`,
      { modal: true },
      'Prejmenovat',
      'Zamitnout'
    );
    approved = choice === 'Prejmenovat';
  }
  if (!approved) return { ok: true, tool: name, approved: false, message: 'zmena zamitnuta uzivatelem' };

  await vscode.workspace.fs.rename(fromUri, toUri, { overwrite: false });
  deps.markToolMutation(session, name);
  return { ok: true, tool: name, approved: true, message: 'soubor prejmenovan' };
}

export async function handleDeleteFileTool(
  name: string,
  args: Record<string, unknown>,
  confirmEdits: boolean,
  autoApprove: AutoApproveLike,
  deps: MutationHandlerDeps,
  session?: ToolSessionLike
): Promise<ToolResultLike> {
  const filePath = deps.asString(args.path);
  if (!filePath) return { ok: false, tool: name, message: 'path je povinny' };
  const resolved = await deps.resolveWorkspaceUri(filePath, true);
  if (!resolved.uri) {
    return {
      ok: false,
      tool: name,
      message: resolved.error ?? 'soubor nenalezen nebo mimo workspace',
      data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
    };
  }
  const uri = resolved.uri;

  let approved = true;
  if (confirmEdits && !autoApprove.edit) {
    const choice = await vscode.window.showInformationMessage(
      `Smazat soubor ${vscode.workspace.asRelativePath(uri)}?`,
      { modal: true },
      'Smazat',
      'Zamitnout'
    );
    approved = choice === 'Smazat';
  }
  if (!approved) return { ok: true, tool: name, approved: false, message: 'zmena zamitnuta uzivatelem' };

  await vscode.workspace.fs.delete(uri, { recursive: false });
  deps.markToolMutation(session, name);
  return { ok: true, tool: name, approved: true, message: 'soubor smazan' };
}

export async function handleFetchWebpageTool(
  name: string,
  args: Record<string, unknown>,
  deps: MutationHandlerDeps
): Promise<ToolResultLike> {
  const url = deps.asString(args.url) ?? deps.asString(args.href);
  if (!url) return { ok: false, tool: name, message: 'url je povinne' };

  const urlCheck = await deps.isSafeUrl(url);
  if (!urlCheck.safe) {
    return { ok: false, tool: name, message: `URL blokována: ${urlCheck.reason}` };
  }

  try {
    const fetch = require('node-fetch');
    let response = await fetch(url, { redirect: 'manual' });

    // Follow redirects safely — re-validate each Location header
    const MAX_REDIRECTS = 5;
    for (let i = 0; i < MAX_REDIRECTS && [301, 302, 303, 307, 308].includes(response.status); i++) {
      const location = response.headers.get('location');
      if (!location) break;
      const resolved = new URL(location, url).toString();
      const redirectCheck = await deps.isSafeUrl(resolved);
      if (!redirectCheck.safe) {
        return { ok: false, tool: name, message: `Redirect blokován: ${redirectCheck.reason}` };
      }
      response = await fetch(resolved, { redirect: 'manual' });
    }

    const html = await response.text();

    // simple string manipulation to strip script and style tags, to save tokens
    let stripped = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    stripped = stripped.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    stripped = stripped.replace(/<[^>]+>/g, ' '); // remove remaining html tags
    stripped = stripped.replace(/\s+/g, ' ').trim(); // normalize whitespace

    return { ok: true, tool: name, message: stripped.substring(0, 50000) };
  } catch (e) {
    return { ok: false, tool: name, message: 'Failed to fetch: ' + String(e) };
  }
}

export async function handleGetDefinitionTool(
  name: string,
  args: Record<string, unknown>,
  deps: MutationHandlerDeps
): Promise<ToolResultLike> {
  const filePath = deps.getFirstStringArg(args, ['path', 'file', 'filePath', 'filename']);
  let uri: vscode.Uri | undefined;
  if (filePath) {
    const resolved = await deps.resolveWorkspaceUri(filePath, true);
    if (!resolved.uri) {
      return {
        ok: false,
        tool: name,
        message: resolved.error ?? 'soubor nenalezen nebo mimo workspace',
        data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
      };
    }
    uri = resolved.uri;
  } else {
    const activeUri = deps.getActiveWorkspaceFileUri();
    if (!activeUri) {
      return { ok: false, tool: name, message: 'path je povinny nebo otevri aktivni soubor' };
    }
    uri = activeUri;
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  const symbolName = deps.asString(args.symbol);
  let posInfo = deps.getPositionFromArgs(args, doc);
  let position = posInfo.position;
  if (!position && symbolName) {
    position = await deps.resolveSymbolPosition(uri, symbolName);
    if (position) {
      posInfo = { position, line: position.line + 1, character: position.character + 1 };
    }
  }
  if (!position) {
    return { ok: false, tool: name, message: posInfo.error ?? 'pozice nenalezena' };
  }

  const definitions = await vscode.commands.executeCommand<
    Array<vscode.Location | vscode.LocationLink> | vscode.Location | undefined
  >('vscode.executeDefinitionProvider', uri, position);
  const list = Array.isArray(definitions) ? definitions : (definitions ? [definitions] : []);
  const maxResults = deps.clampNumber(args.maxResults, deps.DEFAULT_MAX_LSP_RESULTS, 1, 1000);
  const results = list.slice(0, maxResults).map(loc => deps.serializeLocationInfo(loc));

  return {
    ok: true,
    tool: name,
    data: {
      path: deps.getRelativePathForWorkspace(uri),
      position: { line: posInfo.line ?? position.line + 1, character: posInfo.character ?? position.character + 1 },
      definitions: results,
      total: list.length,
      truncated: list.length > maxResults
    }
  };
}

function collectDocumentSymbolsForTool(
  symbols: vscode.DocumentSymbol[],
  maxDepth: number,
  maxResults: number,
  deps: MutationHandlerDeps
): { symbols: Array<Record<string, unknown>>; total: number; truncated: boolean } {
  let count = 0;
  let truncated = false;
  const walk = (symbol: vscode.DocumentSymbol, depth: number): Record<string, unknown> | null => {
    if (count >= maxResults) {
      truncated = true;
      return null;
    }
    count++;
    const node: Record<string, unknown> = {
      name: symbol.name,
      kind: deps.serializeSymbolKind(symbol.kind),
      detail: symbol.detail,
      range: deps.serializeRange(symbol.range),
      selectionRange: deps.serializeRange(symbol.selectionRange)
    };
    if (symbol.children && symbol.children.length > 0 && depth < maxDepth) {
      const children: Array<Record<string, unknown>> = [];
      for (const child of symbol.children) {
        const childNode = walk(child, depth + 1);
        if (childNode) children.push(childNode);
      }
      node.children = children;
    }
    return node;
  };
  const result: Array<Record<string, unknown>> = [];
  for (const symbol of symbols) {
    const node = walk(symbol, 0);
    if (node) result.push(node);
  }
  return { symbols: result, total: count, truncated };
}

function collectSymbolInformationForTool(
  symbols: vscode.SymbolInformation[],
  maxResults: number,
  deps: MutationHandlerDeps
): { symbols: Array<Record<string, unknown>>; total: number; truncated: boolean } {
  const result: Array<Record<string, unknown>> = [];
  let count = 0;
  for (const symbol of symbols) {
    if (count >= maxResults) break;
    count++;
    result.push({
      name: symbol.name,
      kind: deps.serializeSymbolKind(symbol.kind),
      containerName: symbol.containerName,
      range: deps.serializeRange(symbol.location.range)
    });
  }
  return { symbols: result, total: count, truncated: count >= maxResults };
}

export async function handleGetSymbolsTool(
  name: string,
  args: Record<string, unknown>,
  deps: MutationHandlerDeps
): Promise<ToolResultLike> {
  const filePath = deps.getFirstStringArg(args, ['path', 'file', 'filePath', 'filename']);
  let uri: vscode.Uri | undefined;
  if (filePath) {
    const resolved = await deps.resolveWorkspaceUri(filePath, true);
    if (!resolved.uri) {
      return {
        ok: false,
        tool: name,
        message: resolved.error ?? 'soubor nenalezen nebo mimo workspace',
        data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
      };
    }
    uri = resolved.uri;
  } else {
    const activeUri = deps.getActiveWorkspaceFileUri();
    if (!activeUri) {
      return { ok: false, tool: name, message: 'path je povinny nebo otevri aktivni soubor' };
    }
    uri = activeUri;
  }

  const maxResults = deps.clampNumber(args.maxResults, deps.DEFAULT_MAX_LSP_RESULTS, 1, 1000);
  const maxDepth = deps.clampNumber(args.maxDepth, 3, 0, 10);
  const symbols = await vscode.commands.executeCommand<
    Array<vscode.DocumentSymbol> | Array<vscode.SymbolInformation> | undefined
  >('vscode.executeDocumentSymbolProvider', uri);
  const relativePath = deps.getRelativePathForWorkspace(uri);

  if (!symbols || symbols.length === 0) {
    return { ok: true, tool: name, data: { path: relativePath, symbols: [], total: 0 } };
  }

  const first = symbols[0] as unknown;
  const payload = (first as { location?: unknown }).location !== undefined
    ? collectSymbolInformationForTool(symbols as vscode.SymbolInformation[], maxResults, deps)
    : collectDocumentSymbolsForTool(symbols as vscode.DocumentSymbol[], maxDepth, maxResults, deps);

  return {
    ok: true,
    tool: name,
    data: {
      path: relativePath,
      maxDepth,
      ...payload
    }
  };
}

export async function handleGetWorkspaceSymbolsTool(
  name: string,
  args: Record<string, unknown>,
  deps: MutationHandlerDeps
): Promise<ToolResultLike> {
  const query = deps.asString(args.query) ?? '';
  const maxResults = deps.clampNumber(args.maxResults, deps.DEFAULT_MAX_LSP_RESULTS, 1, 1000);
  const symbols = await vscode.commands.executeCommand<
    Array<vscode.SymbolInformation> | undefined
  >('vscode.executeWorkspaceSymbolProvider', query);
  if (!symbols || symbols.length === 0) {
    return { ok: true, tool: name, data: { query, symbols: [], total: 0 } };
  }
  const results: Array<Record<string, unknown>> = [];
  for (const symbol of symbols) {
    if (results.length >= maxResults) break;
    const location = (symbol as { location?: vscode.Location | vscode.LocationLink }).location;
    results.push({
      name: symbol.name,
      kind: deps.serializeSymbolKind(symbol.kind),
      containerName: symbol.containerName,
      location: location ? deps.serializeLocationInfo(location) : undefined
    });
  }
  return {
    ok: true,
    tool: name,
    data: {
      query,
      symbols: results,
      total: symbols.length,
      truncated: symbols.length > maxResults
    }
  };
}

export async function handleGetReferencesTool(
  name: string,
  args: Record<string, unknown>,
  deps: MutationHandlerDeps
): Promise<ToolResultLike> {
  const filePath = deps.getFirstStringArg(args, ['path', 'file', 'filePath', 'filename']);
  let uri: vscode.Uri | undefined;
  if (filePath) {
    const resolved = await deps.resolveWorkspaceUri(filePath, true);
    if (!resolved.uri) {
      return {
        ok: false,
        tool: name,
        message: resolved.error ?? 'soubor nenalezen nebo mimo workspace',
        data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
      };
    }
    uri = resolved.uri;
  } else {
    const activeUri = deps.getActiveWorkspaceFileUri();
    if (!activeUri) {
      return { ok: false, tool: name, message: 'path je povinny nebo otevri aktivni soubor' };
    }
    uri = activeUri;
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  const posInfo = deps.getPositionFromArgs(args, doc);
  if (!posInfo.position) {
    return { ok: false, tool: name, message: posInfo.error ?? 'pozice nenalezena' };
  }
  const includeDeclaration = typeof args.includeDeclaration === 'boolean' ? args.includeDeclaration : false;
  const references = await vscode.commands.executeCommand<vscode.Location[]>(
    'vscode.executeReferenceProvider',
    uri,
    posInfo.position,
    { includeDeclaration }
  );
  const list = references ?? [];
  const maxResults = deps.clampNumber(args.maxResults, deps.DEFAULT_MAX_LSP_RESULTS, 1, 1000);
  const results = list.slice(0, maxResults).map(loc => deps.serializeLocationInfo(loc));
  return {
    ok: true,
    tool: name,
    data: {
      path: deps.getRelativePathForWorkspace(uri),
      position: {
        line: posInfo.line ?? posInfo.position.line + 1,
        character: posInfo.character ?? posInfo.position.character + 1
      },
      includeDeclaration,
      references: results,
      total: list.length,
      truncated: list.length > maxResults
    }
  };
}

export async function handleGetTypeInfoTool(
  name: string,
  args: Record<string, unknown>,
  deps: MutationHandlerDeps
): Promise<ToolResultLike> {
  const filePath = deps.getFirstStringArg(args, ['path', 'file', 'filePath', 'filename']);
  let uri: vscode.Uri | undefined;
  if (filePath) {
    const resolved = await deps.resolveWorkspaceUri(filePath, true);
    if (!resolved.uri) {
      return {
        ok: false,
        tool: name,
        message: resolved.error ?? 'soubor nenalezen nebo mimo workspace',
        data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
      };
    }
    uri = resolved.uri;
  } else {
    const activeUri = deps.getActiveWorkspaceFileUri();
    if (!activeUri) {
      return { ok: false, tool: name, message: 'path je povinny nebo otevri aktivni soubor' };
    }
    uri = activeUri;
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  const posInfo = deps.getPositionFromArgs(args, doc);
  if (!posInfo.position) {
    return { ok: false, tool: name, message: posInfo.error ?? 'pozice nenalezena' };
  }
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    uri,
    posInfo.position
  );
  const list = hovers ?? [];
  const maxResults = deps.clampNumber(args.maxResults, deps.DEFAULT_MAX_LSP_RESULTS, 1, 1000);
  const results = list.slice(0, maxResults).map(hover => ({
    range: hover.range ? deps.serializeRange(hover.range) : undefined,
    contents: deps.renderHoverContents(hover.contents)
  }));
  return {
    ok: true,
    tool: name,
    data: {
      path: deps.getRelativePathForWorkspace(uri),
      position: {
        line: posInfo.line ?? posInfo.position.line + 1,
        character: posInfo.character ?? posInfo.position.character + 1
      },
      hovers: results,
      total: list.length,
      truncated: list.length > maxResults
    }
  };
}

export async function handleApplyPatchTool(
  name: string,
  args: Record<string, unknown>,
  confirmEdits: boolean,
  autoApprove: AutoApproveLike,
  deps: MutationHandlerDeps,
  session?: ToolSessionLike
): Promise<ToolResultLike> {
  const diffText = deps.getFirstStringArg(args, ['diff', 'patch', 'text', 'content']);
  if (!diffText) return { ok: false, tool: name, message: 'diff je povinny' };

  const patches = deps.parseUnifiedDiff(diffText);
  if (patches.length === 0) {
    return { ok: false, tool: name, message: 'neplatny diff' };
  }
  const autoOpenAutoSave = deps.getToolsAutoOpenAutoSaveSetting();
  const autoOpenOnWrite = deps.getToolsAutoOpenOnWriteSetting();
  const appliedFiles: Array<{ path: string; action: 'created' | 'updated' | 'deleted'; hunksApplied: number; hunksTotal: number }> = [];

  for (const patch of patches) {
    const targetPath = patch.newPath || patch.oldPath;
    if (!targetPath) continue;
    const isDelete = Boolean(patch.oldPath) && !patch.newPath;
    if (deps.isBinaryExtension(targetPath)) {
      return { ok: false, tool: name, message: 'cesta vypada jako binarni soubor (extenze)' };
    }
    const resolved = await deps.resolveWorkspaceUri(targetPath, !isDelete);
    if (!resolved.uri) {
      const data: Record<string, unknown> = {};
      if (resolved.conflicts) data.conflicts = resolved.conflicts;
      if (appliedFiles.length > 0) data.appliedFiles = appliedFiles;
      return {
        ok: false,
        tool: name,
        message: resolved.error ?? 'soubor mimo workspace',
        data: Object.keys(data).length > 0 ? data : undefined
      };
    }
    const uri = resolved.uri;
    let exists = true;
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      exists = false;
    }

    let originalText = '';
    if (exists) {
      const readResult = await deps.readFileForTool(uri, deps.DEFAULT_MAX_WRITE_BYTES);
      if (readResult.text === undefined) {
        const data: Record<string, unknown> = {
          sizeBytes: readResult.size,
          binary: readResult.binary ?? false
        };
        if (appliedFiles.length > 0) data.appliedFiles = appliedFiles;
        return {
          ok: false,
          tool: name,
          message: readResult.error ?? 'soubor nelze precist',
          data
        };
      }
      originalText = readResult.text;
    }

    const applied = deps.applyUnifiedDiffToText(originalText, patch.hunks);
    if (applied.text === undefined) {
      return {
        ok: false,
        tool: name,
        message: applied.error ?? 'nelze aplikovat diff',
        data: {
          path: deps.getRelativePathForWorkspace(uri),
          appliedHunks: applied.appliedHunks,
          totalHunks: applied.totalHunks,
          appliedFiles
        }
      };
    }

    let approved = true;
    if (confirmEdits && !autoApprove.edit) {
      if (exists) {
        approved = await deps.showDiffAndConfirm(uri, applied.text, `Navrh zmen: ${vscode.workspace.asRelativePath(uri)}`);
      } else {
        const previewDoc = await vscode.workspace.openTextDocument({ content: applied.text });
        await vscode.window.showTextDocument(previewDoc, { preview: true });
        const choice = await vscode.window.showInformationMessage(
          `Vytvorit novy soubor ${vscode.workspace.asRelativePath(uri)}?`,
          { modal: true },
          'Vytvorit',
          'Zamitnout'
        );
        approved = choice === 'Vytvorit';
      }
    }

    if (!approved) {
      return { ok: true, tool: name, approved: false, message: 'zmena zamitnuta uzivatelem' };
    }

    if (isDelete) {
      await vscode.workspace.fs.delete(uri, { recursive: false });
      deps.markToolMutation(session, name);
      appliedFiles.push({
        path: deps.getRelativePathForWorkspace(uri),
        action: 'deleted',
        hunksApplied: applied.appliedHunks,
        hunksTotal: applied.totalHunks
      });
      continue;
    }

    if (exists) {
      const appliedOk = await deps.applyFileContent(uri, applied.text);
      if (!appliedOk) {
        const data = appliedFiles.length > 0 ? { appliedFiles } : undefined;
        return { ok: false, tool: name, message: 'nepodarilo se aplikovat diff', data };
      }
      const relativePath = deps.getRelativePathForWorkspace(uri);
      deps.markToolMutation(session, name);
      deps.recordToolWrite(session, 'updated', relativePath);
      deps.lastReadHashes.set(uri.fsPath, { hash: deps.computeContentHash(applied.text), updatedAt: Date.now() });
      const shouldOpenUpdated = autoOpenOnWrite || (autoOpenAutoSave && deps.isInAutoSaveDir(uri));
      if (shouldOpenUpdated) {
        await deps.revealWrittenDocument(uri);
      }
      await deps.notifyToolWrite('updated', uri);
      appliedFiles.push({
        path: relativePath,
        action: 'updated',
        hunksApplied: applied.appliedHunks,
        hunksTotal: applied.totalHunks
      });
    } else {
      const parent = vscode.Uri.file(path.dirname(uri.fsPath));
      await vscode.workspace.fs.createDirectory(parent);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(applied.text, 'utf8'));
      const shouldOpenCreated = autoOpenOnWrite || (autoOpenAutoSave && deps.isInAutoSaveDir(uri));
      if (shouldOpenCreated) {
        const opened = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(opened, { preview: false });
      }
      await deps.notifyToolWrite('created', uri);
      const createdPath = deps.getRelativePathForWorkspace(uri);
      deps.markToolMutation(session, name);
      deps.recordToolWrite(session, 'created', createdPath);
      deps.lastReadHashes.set(uri.fsPath, { hash: deps.computeContentHash(applied.text), updatedAt: Date.now() });
      appliedFiles.push({
        path: createdPath,
        action: 'created',
        hunksApplied: applied.appliedHunks,
        hunksTotal: applied.totalHunks
      });
    }
  }

  return {
    ok: true,
    tool: name,
    approved: true,
    message: 'diff aplikovan',
    data: { files: appliedFiles }
  };
}

export async function handleGetDiagnosticsTool(
  name: string,
  args: Record<string, unknown>,
  deps: MutationHandlerDeps
): Promise<ToolResultLike> {
  const filePath = deps.getFirstStringArg(args, ['path', 'file', 'filePath', 'filename']);
  const maxResults = deps.clampNumber(args.maxResults, deps.DEFAULT_MAX_LSP_RESULTS, 1, 1000);
  const results: Array<Record<string, unknown>> = [];
  let total = 0;
  if (filePath) {
    const resolved = await deps.resolveWorkspaceUri(filePath, true);
    if (!resolved.uri) {
      return {
        ok: false,
        tool: name,
        message: resolved.error ?? 'soubor nenalezen nebo mimo workspace',
        data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
      };
    }
    const uri = resolved.uri;
    const diagnostics = vscode.languages.getDiagnostics(uri);
    total = diagnostics.length;
    for (const diag of diagnostics) {
      if (results.length >= maxResults) break;
      results.push({
        path: deps.getRelativePathForWorkspace(uri),
        severity: deps.serializeDiagnosticSeverity(diag.severity),
        message: diag.message,
        range: deps.serializeRange(diag.range),
        source: diag.source,
        code: typeof diag.code === 'object' ? (diag.code as { value?: unknown }).value : diag.code
      });
    }
  } else {
    const allDiagnostics = vscode.languages.getDiagnostics();
    for (const [uri, diagnostics] of allDiagnostics) {
      total += diagnostics.length;
      for (const diag of diagnostics) {
        if (results.length >= maxResults) break;
        results.push({
          path: deps.getRelativePathForWorkspace(uri),
          severity: deps.serializeDiagnosticSeverity(diag.severity),
          message: diag.message,
          range: deps.serializeRange(diag.range),
          source: diag.source,
          code: typeof diag.code === 'object' ? (diag.code as { value?: unknown }).value : diag.code
        });
      }
      if (results.length >= maxResults) break;
    }
  }
  return {
    ok: true,
    tool: name,
    data: {
      diagnostics: results,
      total,
      truncated: total > maxResults
    }
  };
}

export async function handleListFilesTool(
  name: string,
  args: Record<string, unknown>,
  deps: MutationHandlerDeps
): Promise<ToolResultLike> {
  const glob = deps.asString(args.glob) ?? '**/*';
  const maxResults = deps.clampNumber(args.maxResults, deps.DEFAULT_MAX_LIST_RESULTS, 1, 1000);
  const files = await vscode.workspace.findFiles(glob, deps.DEFAULT_EXCLUDE_GLOB, maxResults);
  return {
    ok: true,
    tool: name,
    data: { files: files.map(uri => deps.getRelativePathForWorkspace(uri)) }
  };
}

export async function handleReadFileTool(
  name: string,
  args: Record<string, unknown>,
  deps: MutationHandlerDeps
): Promise<ToolResultLike> {
  const filePath = deps.asString(args.path);
  let uri: vscode.Uri | undefined;
  if (filePath) {
    const resolved = await deps.resolveWorkspaceUri(filePath, true);
    if (!resolved.uri) {
      return {
        ok: false,
        tool: name,
        message: resolved.error ?? 'soubor nenalezen nebo mimo workspace',
        data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
      };
    }
    uri = resolved.uri;
  } else {
    const activeUri = deps.getActiveWorkspaceFileUri();
    if (!activeUri) {
      return { ok: false, tool: name, message: 'path je povinny nebo otevri aktivni soubor' };
    }
    uri = activeUri;
  }
  const readResult = await deps.readFileForTool(uri, deps.DEFAULT_MAX_READ_BYTES);
  if (readResult.text === undefined) {
    return {
      ok: false,
      tool: name,
      message: readResult.error ?? 'soubor nelze precist',
      data: {
        sizeBytes: readResult.size,
        binary: readResult.binary ?? false
      }
    };
  }
  const lines = deps.splitLines(readResult.text);
  const totalLines = lines.length;
  let startLine = deps.clampNumber(args.startLine, 1, 1, totalLines || 1);
  let endLine = deps.clampNumber(args.endLine, totalLines || 1, startLine, totalLines || 1);
  let truncated = false;
  if (endLine - startLine + 1 > deps.DEFAULT_MAX_READ_LINES) {
    endLine = startLine + deps.DEFAULT_MAX_READ_LINES - 1;
    truncated = true;
  }
  const eol = deps.detectEol(readResult.text);
  const content = lines.slice(startLine - 1, endLine).join(eol);
  if (readResult.hash) {
    deps.lastReadHashes.set(uri.fsPath, { hash: readResult.hash, updatedAt: Date.now() });
  }
  return {
    ok: true,
    tool: name,
    message: truncated ? 'obsah zkracen' : undefined,
    data: {
      path: deps.getRelativePathForWorkspace(uri),
      startLine,
      endLine,
      totalLines,
      sizeBytes: readResult.size,
      hash: readResult.hash,
      content
    }
  };
}

export async function handleGetActiveFileTool(
  name: string,
  _args: Record<string, unknown>,
  deps: MutationHandlerDeps
): Promise<ToolResultLike> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return { ok: false, tool: name, message: 'zadny aktivni editor' };
  const doc = editor.document;
  if (deps.isBinaryExtension(doc.fileName)) {
    return { ok: false, tool: name, message: 'soubor vypada jako binarni (extenze)', data: { binary: true } };
  }
  const text = doc.getText();
  const size = Buffer.byteLength(text, 'utf8');
  if (size > deps.DEFAULT_MAX_READ_BYTES) {
    return { ok: false, tool: name, message: `soubor je moc velky (${size} bytes), limit ${deps.DEFAULT_MAX_READ_BYTES}`, data: { sizeBytes: size } };
  }
  const lines = deps.splitLines(text);
  const totalLines = lines.length;
  const eol = deps.detectEol(text);
  const endLine = Math.min(totalLines || 1, deps.DEFAULT_MAX_READ_LINES);
  const content = lines.slice(0, endLine).join(eol);
  const hash = deps.computeContentHash(text);
  deps.lastReadHashes.set(doc.uri.fsPath, { hash, updatedAt: Date.now() });
  return {
    ok: true,
    tool: name,
    data: {
      path: deps.getRelativePathForWorkspace(doc.uri),
      startLine: 1,
      endLine,
      totalLines,
      sizeBytes: size,
      hash,
      content
    }
  };
}

export async function handleSearchInFilesTool(
  name: string,
  args: Record<string, unknown>,
  deps: MutationHandlerDeps
): Promise<ToolResultLike> {
  const query = deps.asString(args.query);
  if (!query) return { ok: false, tool: name, message: 'query je povinny' };

  const isRegex = args.isRegex === true;
  let queryRegex: RegExp | undefined;
  if (isRegex) {
    try {
      queryRegex = new RegExp(query, 'g');
    } catch (e) {
      return { ok: false, tool: name, message: 'Neplatny regex: ' + String(e) };
    }
  }

  const glob = deps.asString(args.glob);
  const maxResults = deps.clampNumber(args.maxResults, deps.DEFAULT_MAX_SEARCH_RESULTS, 1, 200);
  const matches: Array<{ path: string; line: number; text: string }> = [];
  const include = glob ?? '**/*';
  const maxFilesToScan = Math.min(500, Math.max(50, maxResults * 25));
  const files = await vscode.workspace.findFiles(include, deps.DEFAULT_EXCLUDE_GLOB, maxFilesToScan);
  let skippedBinary = 0;
  let skippedLarge = 0;

  for (const uri of files) {
    if (matches.length >= maxResults) break;
    const readResult = await deps.readFileForTool(uri, deps.DEFAULT_MAX_READ_BYTES);
    if (readResult.text === undefined) {
      if (readResult.binary) skippedBinary++;
      if (readResult.size && readResult.size > deps.DEFAULT_MAX_READ_BYTES) skippedLarge++;
      continue;
    }

    const lines = deps.splitLines(readResult.text);
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxResults) break;
      const lineText = lines[i];

      const isMatch = isRegex ? queryRegex!.test(lineText) : lineText.includes(query);
      if (isRegex) queryRegex!.lastIndex = 0;

      if (isMatch) {
        matches.push({
          path: deps.getRelativePathForWorkspace(uri),
          line: i + 1,
          text: lineText.trim()
        });
      }
    }
  }
  return {
    ok: true,
    tool: name,
    data: {
      matches,
      scannedFiles: files.length,
      skippedBinary,
      skippedLarge
    }
  };
}

export async function handleRouteFileTool(
  name: string,
  args: Record<string, unknown>,
  deps: MutationHandlerDeps
): Promise<ToolResultLike> {
  const intent = deps.asString(args.intent);
  if (!intent) return { ok: false, tool: name, message: 'intent je povinny' };

  const preferredExtension = deps.normalizeExtension(deps.asString(args.preferredExtension));
  const fileNameHint = deps.asString(args.fileNameHint) ?? deps.asString(args.suggestedName);
  const maxResults = deps.clampNumber(args.maxResults, 5, 1, 15);
  const glob = deps.asString(args.glob) ?? '**/*';
  const allowCreate = typeof args.allowCreate === 'boolean' ? args.allowCreate : true;
  const maxFilesToScan = Math.min(2000, Math.max(200, maxResults * 200));
  const files = await vscode.workspace.findFiles(glob, deps.DEFAULT_EXCLUDE_GLOB, maxFilesToScan);
  const activeUri = deps.getActiveWorkspaceFileUri();
  const tokens = deps.tokenizeRouteText([intent, fileNameHint].filter(Boolean).join(' '));
  const hintName = fileNameHint
    ? deps.normalizeRouteText(path.parse(fileNameHint).name)
    : '';
  const candidates: Array<{ path: string; score: number; reason: string }> = [];

  for (const uri of files) {
    const relPath = deps.getRelativePathForWorkspace(uri);
    const lowerPath = deps.normalizeRouteText(relPath);
    const ext = path.extname(relPath).toLowerCase();
    if (deps.BINARY_EXTENSIONS.has(ext)) continue;
    const baseName = path.basename(lowerPath);
    let score = 0;
    const reasons: string[] = [];

    if (preferredExtension && ext === preferredExtension) {
      score += 6;
      reasons.push('ext');
    }
    if (hintName) {
      if (baseName === `${hintName}${ext}`) {
        score += 10;
        reasons.push('hint-exact');
      } else if (baseName.includes(hintName)) {
        score += 6;
        reasons.push('hint-base');
      } else if (lowerPath.includes(hintName)) {
        score += 3;
        reasons.push('hint-path');
      }
    }

    let matchedTokens = 0;
    for (const token of tokens) {
      if (baseName.includes(token)) {
        score += 2;
        matchedTokens++;
      } else if (lowerPath.includes(token)) {
        score += 1;
        matchedTokens++;
      }
    }
    if (matchedTokens > 0) {
      reasons.push(`tokens:${matchedTokens}`);
    }

    if (activeUri && uri.fsPath === activeUri.fsPath) {
      score += 2;
      reasons.push('active');
    }

    if (score > 0) {
      candidates.push({
        path: relPath,
        score,
        reason: reasons.join('+') || 'match'
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const topCandidates = candidates.slice(0, maxResults);
  let bestPath = topCandidates[0]?.path;
  let autoSavePath: string | undefined;

  if (!bestPath && activeUri) {
    bestPath = deps.getRelativePathForWorkspace(activeUri);
  }

  if (!bestPath && allowCreate) {
    const fileName = deps.buildAutoFileName({
      title: intent,
      suggestedName: fileNameHint,
      extension: preferredExtension
    });
    const resolved = await deps.resolveAutoSaveTargetUri(fileName);
    if (resolved.uri) {
      autoSavePath = deps.getRelativePathForWorkspace(resolved.uri);
      bestPath = autoSavePath;
    }
  }

  return {
    ok: true,
    tool: name,
    data: {
      bestPath,
      candidates: topCandidates,
      autoSavePath
    }
  };
}

export async function handlePickSavePathTool(
  name: string,
  args: Record<string, unknown>,
  deps: MutationHandlerDeps
): Promise<ToolResultLike> {
  const title = deps.asString(args.title);
  const suggestedNameRaw = deps.asString(args.suggestedName);
  const extensionRaw = deps.asString(args.extension);
  const fileName = deps.buildAutoFileName({
    title,
    suggestedName: suggestedNameRaw,
    extension: extensionRaw
  });
  const resolved = await deps.resolveAutoSaveTargetUri(fileName);
  if (!resolved.uri) {
    return { ok: false, tool: name, message: resolved.error ?? 'nelze vytvorit cestu' };
  }
  const uri = resolved.uri;

  return {
    ok: true,
    tool: name,
    data: {
      path: deps.getRelativePathForWorkspace(uri),
      fileName: path.basename(uri.fsPath),
      folder: deps.getRelativePathForWorkspace(vscode.Uri.file(path.dirname(uri.fsPath)))
    }
  };
}
