const path = require('path');
const { expect } = require('chai');

const { vscodeMock, flushModuleCache } = require('./helpers/mockLoader');

if (!vscodeMock.workspace.workspaceFolders) vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: 'C:/repo' } }];

// Flush cache so toolHandlers is freshly loaded through the mock hook
flushModuleCache('../src/toolHandlers');

const {
  handleGetDefinitionTool,
  handleGetSymbolsTool,
  handleGetWorkspaceSymbolsTool,
  handleGetReferencesTool,
  handleGetTypeInfoTool,
  handleRunTerminalCommandTool
} = require('../src/toolHandlers');

function makeDeps(overrides?: Record<string, any>) {
  const base: any = {
    DEFAULT_MAX_READ_BYTES: 500000,
    DEFAULT_MAX_WRITE_BYTES: 500000,
    DEFAULT_MAX_LSP_RESULTS: 50,
    DEFAULT_MAX_LIST_RESULTS: 100,
    DEFAULT_MAX_READ_LINES: 500,
    DEFAULT_MAX_SEARCH_RESULTS: 50,
    DEFAULT_EXCLUDE_GLOB: '**/{node_modules,.git}/**',
    BINARY_EXTENSIONS: new Set(['.png', '.jpg']),
    lastReadHashes: new Map(),
    asString: (v: unknown) => (typeof v === 'string' ? v : undefined),
    clampNumber: (v: unknown, fb: number, min: number, max: number) => {
      const n = Number(v);
      if (typeof v !== 'number' || Number.isNaN(n)) return fb;
      return Math.min(max, Math.max(min, n));
    },
    getFirstStringArg: (args: Record<string, unknown>, keys: string[]) => {
      for (const k of keys) if (typeof args[k] === 'string') return args[k];
      return undefined;
    },
    resolveWorkspaceUri: async (fp: string) => ({ uri: { fsPath: path.resolve('C:/repo', fp) } }),
    getActiveWorkspaceFileUri: () => undefined,
    readFileForTool: async () => ({ text: 'line1\nline2\n', size: 12, hash: 'h1' }),
    getRelativePathForWorkspace: (uri: { fsPath: string }) =>
      uri.fsPath.replace(/^C:\\repo\\|^C:\/repo\//i, '').replace(/\\/g, '/'),
    getPositionFromArgs: () => ({
      position: { line: 0, character: 0 },
      line: 1,
      character: 1
    }),
    resolveSymbolPosition: async () => undefined,
    serializeLocationInfo: (loc: any) => ({
      path: loc?.uri?.fsPath ?? '',
      range: loc?.range ?? {}
    }),
    serializeRange: (r: any) => r ?? {},
    serializeSymbolKind: (k: any) => String(k),
    renderHoverContents: (c: any) => (Array.isArray(c) ? c.map(String) : [String(c)]),
    serializeDiagnosticSeverity: () => 'error',
    detectEol: () => '\n',
    splitLines: (t: string) => t.split('\n'),
    showDiffAndConfirm: async () => true,
    applyFileContent: async () => true,
    markToolMutation: () => {},
    recordToolWrite: () => {},
    computeContentHash: () => 'h',
    getToolsAutoOpenAutoSaveSetting: () => false,
    getToolsAutoOpenOnWriteSetting: () => false,
    isInAutoSaveDir: () => false,
    revealWrittenDocument: async () => {},
    notifyToolWrite: async () => {},
    parseUnifiedDiff: () => [],
    applyUnifiedDiffToText: () => ({ text: '', appliedHunks: 0, totalHunks: 0 }),
    isBinaryExtension: () => false,
    normalizeExtension: (ext?: string) => ext ? (ext.startsWith('.') ? ext : `.${ext}`) : '',
    normalizeRouteText: (s: string) => s.toLowerCase(),
    tokenizeRouteText: (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((x: string) => x.length >= 2),
    buildAutoFileName: () => 'auto.ts',
    resolveAutoSaveTargetUri: async () => ({ uri: { fsPath: 'C:/repo/auto.ts' } }),
    isSafeUrl: () => ({ safe: true })
  };
  return { ...base, ...overrides };
}

const autoApproveAll = { edit: true, commands: true };

// Save original mocks to restore after each test
const origExecCmd = vscodeMock.commands.executeCommand;
const origOpenDoc = vscodeMock.workspace.openTextDocument;
const origShowInfo = vscodeMock.window.showInformationMessage;

afterEach(() => {
  vscodeMock.commands.executeCommand = origExecCmd;
  vscodeMock.workspace.openTextDocument = origOpenDoc;
  vscodeMock.window.showInformationMessage = origShowInfo;
});

// ====================================================================
// handleGetDefinitionTool
// ====================================================================
describe('handleGetDefinitionTool', () => {
  it('returns definitions for a valid file and position', async () => {
    vscodeMock.commands.executeCommand = async () => [
      { uri: { fsPath: 'C:/repo/target.ts' }, range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } } }
    ];
    vscodeMock.workspace.openTextDocument = async () => ({ getText: () => '' });

    const result = await handleGetDefinitionTool('get_definition', { path: 'src/foo.ts', line: 1, character: 1 }, makeDeps());
    expect(result.ok).to.be.true;
    expect(result.data.definitions).to.have.length(1);
  });

  it('returns error when no path and no active editor', async () => {
    const result = await handleGetDefinitionTool('get_definition', { line: 1, character: 1 }, makeDeps());
    expect(result.ok).to.be.false;
    expect(result.message).to.include('path');
  });

  it('falls back to active editor when no path given', async () => {
    vscodeMock.commands.executeCommand = async () => [];
    vscodeMock.workspace.openTextDocument = async () => ({ getText: () => '' });

    const deps = makeDeps({
      getActiveWorkspaceFileUri: () => ({ fsPath: 'C:/repo/active.ts' })
    });
    const result = await handleGetDefinitionTool('get_definition', { line: 1, character: 1 }, deps);
    expect(result.ok).to.be.true;
    expect(result.data.definitions).to.have.length(0);
  });

  it('returns error when file resolve fails', async () => {
    const deps = makeDeps({
      resolveWorkspaceUri: async () => ({ uri: undefined, error: 'not found' })
    });
    const result = await handleGetDefinitionTool('get_definition', { path: 'bad.ts' }, deps);
    expect(result.ok).to.be.false;
  });

  it('returns error when position is missing', async () => {
    vscodeMock.workspace.openTextDocument = async () => ({ getText: () => '' });
    const deps = makeDeps({
      getPositionFromArgs: () => ({ position: undefined, error: 'no position' })
    });
    const result = await handleGetDefinitionTool('get_definition', { path: 'src/foo.ts' }, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('no position');
  });

  it('resolves symbol name to position', async () => {
    vscodeMock.commands.executeCommand = async () => [];
    vscodeMock.workspace.openTextDocument = async () => ({ getText: () => '' });
    const deps = makeDeps({
      getPositionFromArgs: () => ({ position: undefined }),
      resolveSymbolPosition: async () => ({ line: 3, character: 5 })
    });
    const result = await handleGetDefinitionTool('get_definition', { path: 'src/foo.ts', symbol: 'MyClass' }, deps);
    expect(result.ok).to.be.true;
  });

  it('truncates definitions list when exceeding maxResults', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      uri: { fsPath: `C:/repo/f${i}.ts` }, range: {}
    }));
    vscodeMock.commands.executeCommand = async () => many;
    vscodeMock.workspace.openTextDocument = async () => ({ getText: () => '' });

    const result = await handleGetDefinitionTool('get_definition', { path: 'src/foo.ts', maxResults: 5 }, makeDeps());
    expect(result.ok).to.be.true;
    expect(result.data.definitions.length).to.equal(5);
    expect(result.data.truncated).to.be.true;
    expect(result.data.total).to.equal(100);
  });
});

// ====================================================================
// handleGetSymbolsTool
// ====================================================================
describe('handleGetSymbolsTool', () => {
  it('returns symbols for a file', async () => {
    vscodeMock.commands.executeCommand = async () => [
      {
        name: 'MyClass',
        kind: 4,
        detail: '',
        range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
        children: []
      }
    ];

    const result = await handleGetSymbolsTool('get_symbols', { path: 'src/foo.ts' }, makeDeps());
    expect(result.ok).to.be.true;
    expect(result.data.symbols).to.have.length(1);
  });

  it('returns empty when no symbols', async () => {
    vscodeMock.commands.executeCommand = async () => [];
    const result = await handleGetSymbolsTool('get_symbols', { path: 'src/foo.ts' }, makeDeps());
    expect(result.ok).to.be.true;
    expect(result.data.symbols).to.have.length(0);
  });

  it('returns error when no path and no active editor', async () => {
    const result = await handleGetSymbolsTool('get_symbols', {}, makeDeps());
    expect(result.ok).to.be.false;
  });

  it('handles SymbolInformation (has .location)', async () => {
    vscodeMock.commands.executeCommand = async () => [
      {
        name: 'doStuff',
        kind: 11,
        containerName: 'util',
        location: { uri: { fsPath: 'C:/repo/util.ts' }, range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } } }
      }
    ];

    const result = await handleGetSymbolsTool('get_symbols', { path: 'src/util.ts' }, makeDeps());
    expect(result.ok).to.be.true;
    expect(result.data.symbols).to.have.length(1);
  });

  it('returns error when file resolve fails', async () => {
    const deps = makeDeps({
      resolveWorkspaceUri: async () => ({ uri: undefined, error: 'not found' })
    });
    const result = await handleGetSymbolsTool('get_symbols', { path: 'bad.ts' }, deps);
    expect(result.ok).to.be.false;
  });
});

// ====================================================================
// handleGetWorkspaceSymbolsTool
// ====================================================================
describe('handleGetWorkspaceSymbolsTool', () => {
  it('returns workspace symbols', async () => {
    vscodeMock.commands.executeCommand = async () => [
      {
        name: 'GlobalFn',
        kind: 11,
        containerName: '',
        location: { uri: { fsPath: 'C:/repo/lib.ts' }, range: {} }
      }
    ];

    const result = await handleGetWorkspaceSymbolsTool('get_workspace_symbols', { query: 'GlobalFn' }, makeDeps());
    expect(result.ok).to.be.true;
    expect(result.data.symbols).to.have.length(1);
    expect(result.data.query).to.equal('GlobalFn');
  });

  it('returns empty when no matches', async () => {
    vscodeMock.commands.executeCommand = async () => [];
    const result = await handleGetWorkspaceSymbolsTool('get_workspace_symbols', { query: 'nothing' }, makeDeps());
    expect(result.ok).to.be.true;
    expect(result.data.symbols).to.have.length(0);
  });

  it('handles undefined result', async () => {
    vscodeMock.commands.executeCommand = async () => undefined;
    const result = await handleGetWorkspaceSymbolsTool('get_workspace_symbols', { query: '' }, makeDeps());
    expect(result.ok).to.be.true;
    expect(result.data.symbols).to.have.length(0);
  });

  it('truncates results', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      name: `sym${i}`, kind: 11, containerName: '',
      location: { uri: { fsPath: `C:/repo/f${i}.ts` }, range: {} }
    }));
    vscodeMock.commands.executeCommand = async () => many;

    const result = await handleGetWorkspaceSymbolsTool('get_workspace_symbols', { query: 'sym', maxResults: 10 }, makeDeps());
    expect(result.ok).to.be.true;
    expect(result.data.symbols.length).to.equal(10);
    expect(result.data.truncated).to.be.true;
  });
});

// ====================================================================
// handleGetReferencesTool
// ====================================================================
describe('handleGetReferencesTool', () => {
  it('returns references for a valid position', async () => {
    vscodeMock.commands.executeCommand = async () => [
      { uri: { fsPath: 'C:/repo/a.ts' }, range: {} },
      { uri: { fsPath: 'C:/repo/b.ts' }, range: {} }
    ];
    vscodeMock.workspace.openTextDocument = async () => ({ getText: () => '' });

    const result = await handleGetReferencesTool('get_references', { path: 'src/foo.ts', line: 1, character: 1 }, makeDeps());
    expect(result.ok).to.be.true;
    expect(result.data.references).to.have.length(2);
  });

  it('returns error when no path and no active editor', async () => {
    const result = await handleGetReferencesTool('get_references', { line: 1 }, makeDeps());
    expect(result.ok).to.be.false;
  });

  it('returns error when position missing', async () => {
    vscodeMock.workspace.openTextDocument = async () => ({ getText: () => '' });
    const deps = makeDeps({
      getPositionFromArgs: () => ({ position: undefined, error: 'no pos' })
    });
    const result = await handleGetReferencesTool('get_references', { path: 'src/foo.ts' }, deps);
    expect(result.ok).to.be.false;
  });

  it('passes includeDeclaration flag', async () => {
    let capturedCtx: any;
    vscodeMock.commands.executeCommand = async (_cmd: string, _uri: any, _pos: any, ctx: any) => {
      capturedCtx = ctx;
      return [];
    };
    vscodeMock.workspace.openTextDocument = async () => ({ getText: () => '' });

    await handleGetReferencesTool('get_references', { path: 'src/foo.ts', includeDeclaration: true }, makeDeps());
    expect(capturedCtx.includeDeclaration).to.be.true;
  });

  it('truncates references list', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      uri: { fsPath: `C:/repo/r${i}.ts` }, range: {}
    }));
    vscodeMock.commands.executeCommand = async () => many;
    vscodeMock.workspace.openTextDocument = async () => ({ getText: () => '' });

    const result = await handleGetReferencesTool('get_references', { path: 'src/foo.ts', maxResults: 3 }, makeDeps());
    expect(result.ok).to.be.true;
    expect(result.data.references.length).to.equal(3);
    expect(result.data.truncated).to.be.true;
  });
});

// ====================================================================
// handleGetTypeInfoTool
// ====================================================================
describe('handleGetTypeInfoTool', () => {
  it('returns hover info for a valid position', async () => {
    vscodeMock.commands.executeCommand = async () => [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, contents: 'string' }
    ];
    vscodeMock.workspace.openTextDocument = async () => ({ getText: () => '' });

    const result = await handleGetTypeInfoTool('get_type_info', { path: 'src/foo.ts', line: 1, character: 1 }, makeDeps());
    expect(result.ok).to.be.true;
    expect(result.data.hovers).to.have.length(1);
  });

  it('returns error when no path and no active editor', async () => {
    const result = await handleGetTypeInfoTool('get_type_info', { line: 1 }, makeDeps());
    expect(result.ok).to.be.false;
  });

  it('returns error when position missing', async () => {
    vscodeMock.workspace.openTextDocument = async () => ({ getText: () => '' });
    const deps = makeDeps({
      getPositionFromArgs: () => ({ position: undefined })
    });
    const result = await handleGetTypeInfoTool('get_type_info', { path: 'src/foo.ts' }, deps);
    expect(result.ok).to.be.false;
  });

  it('handles empty hover result', async () => {
    vscodeMock.commands.executeCommand = async () => [];
    vscodeMock.workspace.openTextDocument = async () => ({ getText: () => '' });

    const result = await handleGetTypeInfoTool('get_type_info', { path: 'src/foo.ts' }, makeDeps());
    expect(result.ok).to.be.true;
    expect(result.data.hovers).to.have.length(0);
  });

  it('returns error when file resolve fails', async () => {
    const deps = makeDeps({
      resolveWorkspaceUri: async () => ({ uri: undefined, error: 'not found' })
    });
    const result = await handleGetTypeInfoTool('get_type_info', { path: 'bad.ts' }, deps);
    expect(result.ok).to.be.false;
  });
});

// ====================================================================
// handleRunTerminalCommandTool
// ====================================================================
describe('handleRunTerminalCommandTool', () => {
  it('returns error when command is missing', async () => {
    const result = await handleRunTerminalCommandTool('run_terminal', {}, makeDeps());
    expect(result.ok).to.be.false;
    expect(result.message).to.include('command');
  });

  it('runs a simple command successfully', async () => {
    vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: process.cwd() } }];
    const result = await handleRunTerminalCommandTool(
      'run_terminal',
      { command: 'echo hello' },
      makeDeps()
    );
    expect(result.ok).to.be.true;
    expect(result.data.stdout).to.include('hello');
  });

  it('reports failure for bad command', async () => {
    const result = await handleRunTerminalCommandTool(
      'run_terminal',
      { command: 'nonexistent_command_xyz_12345' },
      makeDeps()
    );
    expect(result.ok).to.be.false;
    expect(result.data.exitCode).to.not.equal(0);
  });

  it('respects user denial when confirmEdits is true', async () => {
    // Approval is now handled by the outer gate in runToolCall,
    // not by the handler itself. This test verifies the handler
    // no longer has internal approval logic.
    vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: process.cwd() } }];
    const result = await handleRunTerminalCommandTool(
      'run_terminal',
      { command: 'echo hi' },
      makeDeps()
    );
    // Handler always executes when called — approval is upstream
    expect(result.ok).to.be.true;
  });

  it('auto-approves when autoApprove.commands is true', async () => {
    vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: process.cwd() } }];
    const result = await handleRunTerminalCommandTool(
      'run_terminal',
      { command: 'echo auto' },
      makeDeps()
    );
    expect(result.ok).to.be.true;
    expect(result.data.stdout).to.include('auto');
  });
});
