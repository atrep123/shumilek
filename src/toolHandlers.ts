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

export interface MutationHandlerDeps {
  DEFAULT_MAX_READ_BYTES: number;
  DEFAULT_MAX_WRITE_BYTES: number;
  lastReadHashes: Map<string, { hash: string; updatedAt: number }>;
  asString: (value: unknown) => string | undefined;
  clampNumber: (value: unknown, fallback: number, min: number, max: number) => number;
  getFirstStringArg: (args: Record<string, unknown>, keys: string[]) => string | undefined;
  resolveWorkspaceUri: (filePath: string, mustExist: boolean) => Promise<ResolveWorkspaceUriResult>;
  getActiveWorkspaceFileUri: () => vscode.Uri | undefined;
  readFileForTool: (uri: vscode.Uri, maxBytes: number) => Promise<ReadFileForToolResult>;
  getRelativePathForWorkspace: (uri: vscode.Uri) => string;
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
  isBinaryExtension: (filePath: string) => boolean;
  buildAutoFileName: (options: { title?: string; suggestedName?: string; extension?: string; content?: string }) => string;
  resolveAutoSaveTargetUri: (fileName: string) => Promise<{ uri?: vscode.Uri; error?: string }>;
  isSafeUrl: (raw: string) => { safe: boolean; reason?: string };
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
  await vscode.workspace.fs.createDirectory(parent);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
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

export async function handleRunTerminalCommandTool(
  name: string,
  args: Record<string, unknown>,
  confirmEdits: boolean,
  autoApprove: AutoApproveLike,
  deps: MutationHandlerDeps
): Promise<ToolResultLike> {
  const command = deps.asString(args.command);
  if (!command) return { ok: false, tool: name, message: 'command je povinny' };

  const timeoutMs = deps.clampNumber(args.timeoutMs, 30000, 1000, 120000);

  let approved = true;
  if (confirmEdits && !autoApprove.commands) {
    const choice = await vscode.window.showInformationMessage(
      `Spustit příkaz v terminálu?\n\n${command}`,
      { modal: true },
      'Spustit',
      'Zamítnout'
    );
    approved = choice === 'Spustit';
  }
  if (!approved) return { ok: true, tool: name, approved: false, message: 'spusteni zamitnuto uzivatelem' };

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
  const url = deps.asString(args.url);
  if (!url) return { ok: false, tool: name, message: 'url je povinne' };

  const urlCheck = deps.isSafeUrl(url);
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
      const redirectCheck = deps.isSafeUrl(resolved);
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
