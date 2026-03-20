const path = require('path');
const { expect } = require('chai');

// --- vscode mock --- Use shared Module._load hook (Node 24 compatible)
const { vscodeMock, flushModuleCache } = require('./helpers/mockLoader');

// Ensure extra properties needed by coreHandlers
if (!vscodeMock.workspace.fs.rename) vscodeMock.workspace.fs.rename = async () => {};
if (!vscodeMock.workspace.fs.delete) vscodeMock.workspace.fs.delete = async () => {};
if (!vscodeMock.workspace.workspaceFolders) vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: 'C:/repo' } }];
if (!vscodeMock.languages) vscodeMock.languages = { getDiagnostics: () => [] };

// Flush cache so toolHandlers is freshly loaded through the mock hook
flushModuleCache('../src/toolHandlers');

const {
  handleBrowserOpenPageTool,
  handleReplaceLinesTool,
  handleWriteFileTool,
  handleReadFileTool,
  handleListFilesTool,
  handleSearchInFilesTool,
  handleGetActiveFileTool,
  handleRenameFileTool,
  handleDeleteFileTool,
  handleFetchWebpageTool,
  handleGetDiagnosticsTool,
  handleApplyPatchTool,
} = require('../src/toolHandlers');

// --- Helper: minimal deps factory ---
function makeDeps(overrides?: Record<string, any>) {
  const base = {
    DEFAULT_MAX_READ_BYTES: 500000,
    DEFAULT_MAX_WRITE_BYTES: 500000,
    DEFAULT_MAX_LSP_RESULTS: 50,
    DEFAULT_MAX_LIST_RESULTS: 100,
    DEFAULT_MAX_READ_LINES: 500,
    DEFAULT_MAX_SEARCH_RESULTS: 50,
    DEFAULT_EXCLUDE_GLOB: '**/{node_modules,.git}/**',
    BINARY_EXTENSIONS: new Set(['.png', '.jpg', '.gif', '.exe']),
    lastReadHashes: new Map(),
    asString: (v: unknown) => (typeof v === 'string' ? v : undefined),
    clampNumber: (v: unknown, fb: number, min: number, max: number) => {
      const n = Number(v);
      if (typeof v !== 'number' || Number.isNaN(n)) return fb;
      return Math.min(max, Math.max(min, n));
    },
    getFirstStringArg: (args: Record<string, unknown>, keys: string[]) => {
      for (const k of keys) {
        if (typeof args[k] === 'string') return args[k] as string;
      }
      return undefined;
    },
    resolveWorkspaceUri: async (fp: string, mustExist: boolean) => {
      return { uri: { fsPath: path.resolve('C:/repo', fp) } };
    },
    getActiveWorkspaceFileUri: () => undefined,
    readFileForTool: async (_uri: any, _max: number) => ({
      text: 'line1\nline2\nline3\n',
      size: 20,
      hash: 'abc123'
    }),
    getRelativePathForWorkspace: (uri: { fsPath: string }) =>
      uri.fsPath.replace(/^C:\\repo\\|^C:\/repo\//i, '').replace(/\\/g, '/'),
    getPositionFromArgs: () => ({ position: undefined }),
    resolveSymbolPosition: async () => undefined,
    serializeLocationInfo: (loc: any) => ({ path: '', range: {} }),
    serializeRange: (r: any) => ({}),
    serializeSymbolKind: (k: any) => 'unknown',
    renderHoverContents: () => [],
    serializeDiagnosticSeverity: (sev: number) => {
      const m: Record<number, string> = { 0: 'error', 1: 'warning', 2: 'information', 3: 'hint' };
      return m[sev] ?? 'unknown';
    },
    detectEol: (text: string) => (text.includes('\r\n') ? '\r\n' : '\n'),
    splitLines: (text: string) => text.split(/\r\n|\n/),
    showDiffAndConfirm: async () => true,
    applyFileContent: async () => true,
    markToolMutation: () => {},
    recordToolWrite: () => {},
    computeContentHash: (t: string) => 'h_' + t.length,
    getToolsAutoOpenAutoSaveSetting: () => false,
    getToolsAutoOpenOnWriteSetting: () => false,
    isInAutoSaveDir: () => false,
    revealWrittenDocument: async () => {},
    notifyToolWrite: async () => {},
    parseUnifiedDiff: () => [],
    applyUnifiedDiffToText: () => ({ text: '', appliedHunks: 0, totalHunks: 0 }),
    isBinaryExtension: (fp: string) => {
      const ext = path.extname(fp).toLowerCase();
      return ['.png', '.jpg', '.gif', '.exe'].includes(ext);
    },
    normalizeExtension: (ext: string | undefined) => {
      if (!ext) return '';
      const low = String(ext).toLowerCase();
      return low.startsWith('.') ? low : `.${low}`;
    },
    normalizeRouteText: (input: string) => String(input).toLowerCase(),
    tokenizeRouteText: (input: string) => String(input).toLowerCase().split(/[^a-z0-9]+/).filter((x: string) => x.length >= 2),
    buildAutoFileName: () => 'auto.ts',
    resolveAutoSaveTargetUri: async () => ({ uri: { fsPath: 'C:/repo/.shumilek/auto.ts' } }),
    isSafeUrl: (raw: string) => {
      try {
        const u = new URL(raw);
        if (!['http:', 'https:'].includes(u.protocol)) return { safe: false, reason: 'bad protocol' };
        return { safe: true };
      } catch { return { safe: false, reason: 'invalid URL' }; }
    },
    openExternalUrl: async () => true
  };
  return { ...base, ...overrides };
}

const autoApproveAll = { edit: true, commands: true };
const autoApproveDeny = { edit: false, commands: false };

// Restore vscode mock state after each test to prevent cross-file leakage
afterEach(() => {
  vscodeMock.workspace.findFiles = async () => [];
  vscodeMock.workspace.fs.stat = async () => ({ type: 0 });
  vscodeMock.workspace.fs.createDirectory = async () => {};
  vscodeMock.workspace.fs.writeFile = async () => {};
  vscodeMock.workspace.fs.rename = async () => {};
  vscodeMock.workspace.fs.delete = async () => {};
  vscodeMock.window.activeTextEditor = undefined;
  vscodeMock.languages.getDiagnostics = () => [];
});

// ====================== handleReplaceLinesTool ======================
describe('handleReplaceLinesTool', () => {
  it('rejects when required args missing', async () => {
    const deps = makeDeps();
    const result = await handleReplaceLinesTool('replace_lines', {}, false, autoApproveAll, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('povinne');
  });

  it('rejects when startLine/endLine invalid', async () => {
    const deps = makeDeps();
    const result = await handleReplaceLinesTool('replace_lines', { text: 'x' }, false, autoApproveAll, deps);
    expect(result.ok).to.be.false;
  });

  it('rejects file not found', async () => {
    const deps = makeDeps({
      resolveWorkspaceUri: async () => ({ uri: undefined, error: 'not found' })
    });
    const result = await handleReplaceLinesTool('replace_lines', {
      path: 'missing.ts', text: 'new', startLine: 1, endLine: 1
    }, false, autoApproveAll, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('not found');
  });

  it('rejects invalid line range', async () => {
    const deps = makeDeps();
    // file has 4 lines (line1\nline2\nline3\n → split → ['line1','line2','line3',''])
    const result = await handleReplaceLinesTool('replace_lines', {
      path: 'test.ts', text: 'x', startLine: 0, endLine: 1
    }, false, autoApproveAll, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('rozsah');
  });

  it('rejects out-of-range startLine', async () => {
    const deps = makeDeps();
    const result = await handleReplaceLinesTool('replace_lines', {
      path: 'test.ts', text: 'x', startLine: 100, endLine: 100
    }, false, autoApproveAll, deps);
    expect(result.ok).to.be.false;
  });

  it('rejects mismatched expected content', async () => {
    const deps = makeDeps();
    const result = await handleReplaceLinesTool('replace_lines', {
      path: 'test.ts', text: 'newline', startLine: 1, endLine: 1, expected: 'WRONG'
    }, false, autoApproveAll, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('expected');
  });

  it('succeeds with valid args and applies replacement', async () => {
    let appliedContent = '';
    const deps = makeDeps({
      applyFileContent: async (_uri: any, text: string) => { appliedContent = text; return true; }
    });
    const result = await handleReplaceLinesTool('replace_lines', {
      path: 'test.ts', text: 'REPLACED', startLine: 2, endLine: 2
    }, false, autoApproveAll, deps);
    expect(result.ok).to.be.true;
    expect(result.message).to.include('aplikovana');
    expect(appliedContent).to.include('REPLACED');
    expect(appliedContent).to.include('line1');
    expect(appliedContent).not.to.include('line2');
  });

  it('rejects when hash changed since last read', async () => {
    const deps = makeDeps();
    deps.lastReadHashes.set(path.resolve('C:/repo', 'test.ts'), { hash: 'OLD_HASH', updatedAt: 1 });
    const result = await handleReplaceLinesTool('replace_lines', {
      path: 'test.ts', text: 'newline', startLine: 1, endLine: 1
    }, false, autoApproveAll, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('zmenil');
  });

  it('respects user rejection when confirmEdits=true', async () => {
    const deps = makeDeps({
      showDiffAndConfirm: async () => false
    });
    const result = await handleReplaceLinesTool('replace_lines', {
      path: 'test.ts', text: 'x', startLine: 1, endLine: 1
    }, true, autoApproveDeny, deps);
    expect(result.ok).to.be.true;
    expect(result.approved).to.be.false;
  });

  it('falls back to active editor when no path given', async () => {
    const deps = makeDeps({
      getActiveWorkspaceFileUri: () => ({ fsPath: path.resolve('C:/repo', 'active.ts') })
    });
    const result = await handleReplaceLinesTool('replace_lines', {
      text: 'x', startLine: 1, endLine: 1
    }, false, autoApproveAll, deps);
    expect(result.ok).to.be.true;
  });

  it('rejects when no file and no active editor', async () => {
    const deps = makeDeps();
    const result = await handleReplaceLinesTool('replace_lines', {
      text: 'x', startLine: 1, endLine: 1
    }, false, autoApproveAll, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('path');
  });

  it('records mutation in session', async () => {
    const session = { hadMutations: false, mutationTools: [] as string[] };
    let mutationRecorded = false;
    const deps = makeDeps({
      markToolMutation: (s: any, toolName: string) => { mutationRecorded = true; }
    });
    await handleReplaceLinesTool('replace_lines', {
      path: 'test.ts', text: 'x', startLine: 1, endLine: 1
    }, false, autoApproveAll, deps, session);
    expect(mutationRecorded).to.be.true;
  });
});

// ====================== handleReadFileTool ======================
describe('handleReadFileTool', () => {
  it('reads file content successfully', async () => {
    const deps = makeDeps();
    const result = await handleReadFileTool('read_file', { path: 'test.ts' }, deps);
    expect(result.ok).to.be.true;
    expect((result.data as any).content).to.include('line1');
    expect((result.data as any).totalLines).to.be.a('number');
    expect((result.data as any).hash).to.equal('abc123');
  });

  it('fails when file not found', async () => {
    const deps = makeDeps({
      resolveWorkspaceUri: async () => ({ uri: undefined, error: 'soubor nenalezen' })
    });
    const result = await handleReadFileTool('read_file', { path: 'missing.ts' }, deps);
    expect(result.ok).to.be.false;
  });

  it('fails when file cannot be read', async () => {
    const deps = makeDeps({
      readFileForTool: async () => ({ text: undefined, error: 'binary', binary: true, size: 999 })
    });
    const result = await handleReadFileTool('read_file', { path: 'img.png' }, deps);
    expect(result.ok).to.be.false;
    expect((result.data as any).binary).to.be.true;
  });

  it('falls back to active editor when no path', async () => {
    const deps = makeDeps({
      getActiveWorkspaceFileUri: () => ({ fsPath: 'C:/repo/active.ts' })
    });
    const result = await handleReadFileTool('read_file', {}, deps);
    expect(result.ok).to.be.true;
  });

  it('rejects when no path and no active editor', async () => {
    const deps = makeDeps();
    const result = await handleReadFileTool('read_file', {}, deps);
    expect(result.ok).to.be.false;
  });

  it('truncates when range exceeds MAX_READ_LINES', async () => {
    const bigText = Array.from({ length: 600 }, (_, i) => `line${i}`).join('\n');
    const deps = makeDeps({
      readFileForTool: async () => ({ text: bigText, size: bigText.length, hash: 'big' }),
      DEFAULT_MAX_READ_LINES: 100
    });
    const result = await handleReadFileTool('read_file', { path: 'big.ts', startLine: 1, endLine: 600 }, deps);
    expect(result.ok).to.be.true;
    expect(result.message).to.include('zkracen');
    expect((result.data as any).endLine).to.equal(100);
  });

  it('stores hash in lastReadHashes', async () => {
    const deps = makeDeps();
    await handleReadFileTool('read_file', { path: 'test.ts' }, deps);
    const fsPath = path.resolve('C:/repo', 'test.ts');
    expect(deps.lastReadHashes.has(fsPath)).to.be.true;
    expect(deps.lastReadHashes.get(fsPath).hash).to.equal('abc123');
  });
});

// ====================== handleListFilesTool ======================
describe('handleListFilesTool', () => {
  it('lists files from workspace', async () => {
    vscodeMock.workspace.findFiles = async () => [
      { fsPath: 'C:/repo/src/a.ts' },
      { fsPath: 'C:/repo/src/b.ts' }
    ];
    const deps = makeDeps();
    const result = await handleListFilesTool('list_files', {}, deps);
    expect(result.ok).to.be.true;
    const files = (result.data as any).files;
    expect(files).to.be.an('array').with.length(2);
    expect(files[0]).to.equal('src/a.ts');
  });

  it('passes custom glob to findFiles', async () => {
    let receivedGlob = '';
    vscodeMock.workspace.findFiles = async (glob: string) => {
      receivedGlob = glob;
      return [];
    };
    const deps = makeDeps();
    await handleListFilesTool('list_files', { glob: '**/*.md' }, deps);
    expect(receivedGlob).to.equal('**/*.md');
  });
});

// ====================== handleSearchInFilesTool ======================
describe('handleSearchInFilesTool', () => {
  it('rejects when query is missing', async () => {
    const deps = makeDeps();
    const result = await handleSearchInFilesTool('search_in_files', {}, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('query');
  });

  it('finds matching lines', async () => {
    vscodeMock.workspace.findFiles = async () => [
      { fsPath: 'C:/repo/src/test.ts' }
    ];
    const deps = makeDeps({
      readFileForTool: async () => ({
        text: 'hello world\nfoo bar\nhello again',
        size: 30,
        hash: 'h1'
      })
    });
    const result = await handleSearchInFilesTool('search_in_files', { query: 'hello' }, deps);
    expect(result.ok).to.be.true;
    const matches = (result.data as any).matches;
    expect(matches).to.have.length(2);
    expect(matches[0].line).to.equal(1);
    expect(matches[1].line).to.equal(3);
  });

  it('supports regex search', async () => {
    vscodeMock.workspace.findFiles = async () => [
      { fsPath: 'C:/repo/src/test.ts' }
    ];
    const deps = makeDeps({
      readFileForTool: async () => ({
        text: 'const x = 42;\nlet y = 99;\nvar z = 0;',
        size: 35,
        hash: 'h2'
      })
    });
    const result = await handleSearchInFilesTool('search_in_files', {
      query: '(const|let)\\s+\\w+',
      isRegex: true
    }, deps);
    expect(result.ok).to.be.true;
    expect((result.data as any).matches.length).to.equal(2);
  });

  it('rejects invalid regex', async () => {
    const deps = makeDeps();
    const result = await handleSearchInFilesTool('search_in_files', {
      query: '(unclosed',
      isRegex: true
    }, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('regex');
  });

  it('skips binary files', async () => {
    vscodeMock.workspace.findFiles = async () => [
      { fsPath: 'C:/repo/img.png' }
    ];
    const deps = makeDeps({
      readFileForTool: async () => ({ text: undefined, binary: true, size: 5000 })
    });
    const result = await handleSearchInFilesTool('search_in_files', { query: 'foo' }, deps);
    expect(result.ok).to.be.true;
    expect((result.data as any).skippedBinary).to.equal(1);
    expect((result.data as any).matches).to.have.length(0);
  });
});

// ====================== handleWriteFileTool ======================
describe('handleWriteFileTool', () => {
  it('rejects when text is missing', async () => {
    const deps = makeDeps();
    const result = await handleWriteFileTool('write_file', { path: 'test.ts' }, false, autoApproveAll, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('text je povinny');
  });

  it('rejects when content exceeds max write bytes', async () => {
    const deps = makeDeps({ DEFAULT_MAX_WRITE_BYTES: 10 });
    const result = await handleWriteFileTool('write_file', {
      path: 'test.ts', text: 'a'.repeat(100)
    }, false, autoApproveAll, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('velky');
  });

  it('rejects binary extension', async () => {
    const deps = makeDeps();
    const result = await handleWriteFileTool('write_file', {
      path: 'image.png', text: 'hello'
    }, false, autoApproveAll, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('binarni');
  });

  it('creates new file when it does not exist', async () => {
    vscodeMock.workspace.fs.stat = async () => { throw new Error('not found'); };
    let writtenContent = '';
    vscodeMock.workspace.fs.writeFile = async (_uri: any, buf: Buffer) => {
      writtenContent = buf.toString('utf8');
    };
    const deps = makeDeps();
    const result = await handleWriteFileTool('write_file', {
      path: 'new.ts', text: 'hello world'
    }, false, autoApproveAll, deps);
    expect(result.ok).to.be.true;
    expect(result.message).to.include('vytvoren');
    expect(writtenContent).to.equal('hello world');
    expect((result.data as any).action).to.equal('created');
    // Restore stat
    vscodeMock.workspace.fs.stat = async () => ({ type: 0 });
  });

  it('updates existing file', async () => {
    vscodeMock.workspace.fs.stat = async () => ({ type: 0 });
    let applied = '';
    const deps = makeDeps({
      applyFileContent: async (_uri: any, text: string) => { applied = text; return true; }
    });
    const result = await handleWriteFileTool('write_file', {
      path: 'existing.ts', text: 'updated content'
    }, false, autoApproveAll, deps);
    expect(result.ok).to.be.true;
    expect(result.message).to.include('upraven');
    expect(applied).to.equal('updated content');
    expect((result.data as any).action).to.equal('updated');
  });

  it('rejects write when file changed during approval (TOCTOU)', async () => {
    vscodeMock.workspace.fs.stat = async () => ({ type: 0 });
    let readCount = 0;
    const deps = makeDeps({
      readFileForTool: async () => {
        readCount++;
        return {
          text: 'content',
          size: 7,
          hash: readCount === 1 ? 'hash_before' : 'hash_after'
        };
      },
      showDiffAndConfirm: async () => true,
      applyFileContent: async () => { throw new Error('should not reach write'); }
    });
    const result = await handleWriteFileTool('write_file', {
      path: 'existing.ts', text: 'new content'
    }, true, autoApproveDeny, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('zmenil');
  });
});

// ====================== handleRenameFileTool ======================
describe('handleRenameFileTool', () => {
  it('rejects when from or to missing', async () => {
    const deps = makeDeps();
    const r1 = await handleRenameFileTool('rename_file', { from: 'a.ts' }, false, autoApproveAll, deps);
    expect(r1.ok).to.be.false;
    const r2 = await handleRenameFileTool('rename_file', { to: 'b.ts' }, false, autoApproveAll, deps);
    expect(r2.ok).to.be.false;
    const r3 = await handleRenameFileTool('rename_file', {}, false, autoApproveAll, deps);
    expect(r3.ok).to.be.false;
  });

  it('renames file successfully', async () => {
    let renamed = false;
    vscodeMock.workspace.fs.rename = async () => { renamed = true; };
    const deps = makeDeps();
    const result = await handleRenameFileTool('rename_file', {
      from: 'old.ts', to: 'new.ts'
    }, false, autoApproveAll, deps);
    expect(result.ok).to.be.true;
    expect(result.message).to.include('prejmenovan');
    expect(renamed).to.be.true;
  });
});

// ====================== handleDeleteFileTool ======================
describe('handleDeleteFileTool', () => {
  it('rejects when path missing', async () => {
    const deps = makeDeps();
    const result = await handleDeleteFileTool('delete_file', {}, false, autoApproveAll, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('path');
  });

  it('deletes file successfully', async () => {
    let deleted = false;
    vscodeMock.workspace.fs.delete = async () => { deleted = true; };
    const deps = makeDeps();
    const result = await handleDeleteFileTool('delete_file', {
      path: 'temp.ts'
    }, false, autoApproveAll, deps);
    expect(result.ok).to.be.true;
    expect(result.message).to.include('smazan');
    expect(deleted).to.be.true;
  });

  it('rejects when file not found', async () => {
    const deps = makeDeps({
      resolveWorkspaceUri: async () => ({ uri: undefined, error: 'not found' })
    });
    const result = await handleDeleteFileTool('delete_file', {
      path: 'missing.ts'
    }, false, autoApproveAll, deps);
    expect(result.ok).to.be.false;
  });
});

// ====================== handleFetchWebpageTool ======================
describe('handleFetchWebpageTool', () => {
  it('rejects when url missing', async () => {
    const deps = makeDeps();
    const result = await handleFetchWebpageTool('fetch_webpage', {}, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('url');
  });

  it('rejects unsafe URL (non-http)', async () => {
    const deps = makeDeps();
    const result = await handleFetchWebpageTool('fetch_webpage', { url: 'ftp://evil.com' }, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('blokována');
  });

  it('accepts href alias for browser-prefixed fetches', async () => {
    const deps = makeDeps();
    const result = await handleFetchWebpageTool('browser_fetch_page', { href: 'ftp://evil.com' }, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('blokována');
  });
});

describe('handleBrowserOpenPageTool', () => {
  it('rejects unsafe URL', async () => {
    const deps = makeDeps();
    const result = await handleBrowserOpenPageTool('browser_open_page', { url: 'ftp://evil.com' }, deps);
    expect(result.ok).to.be.false;
    expect(result.message).to.include('blokována');
  });

  it('opens safe URL via injected dependency', async () => {
    let openedUrl = '';
    const deps = makeDeps({
      openExternalUrl: async (url: string) => {
        openedUrl = url;
        return true;
      }
    });
    const result = await handleBrowserOpenPageTool('browser_open_page', { url: 'https://example.com' }, deps);
    expect(result.ok).to.be.true;
    expect(openedUrl).to.equal('https://example.com');
  });
});

// ====================== handleGetDiagnosticsTool ======================
describe('handleGetDiagnosticsTool', () => {
  it('returns diagnostics for all files', async () => {
    vscodeMock.languages.getDiagnostics = () => [
      [{ fsPath: 'C:/repo/a.ts' }, [
        { severity: 0, message: 'err', range: {}, source: 'ts', code: 1234 }
      ]]
    ];
    const deps = makeDeps();
    const result = await handleGetDiagnosticsTool('get_diagnostics', {}, deps);
    expect(result.ok).to.be.true;
    expect((result.data as any).diagnostics).to.have.length(1);
    expect((result.data as any).total).to.equal(1);
    // Restore
    vscodeMock.languages.getDiagnostics = () => [];
  });

  it('returns diagnostics for specific file', async () => {
    vscodeMock.languages.getDiagnostics = (uri?: any) => {
      if (uri) return [{ severity: 1, message: 'warn', range: {}, source: 'eslint', code: 'no-unused' }];
      return [];
    };
    const deps = makeDeps();
    const result = await handleGetDiagnosticsTool('get_diagnostics', { path: 'src/a.ts' }, deps);
    expect(result.ok).to.be.true;
    expect((result.data as any).diagnostics).to.have.length(1);
    // Restore
    vscodeMock.languages.getDiagnostics = () => [];
  });
});

// ====================== handleApplyPatchTool TOCTOU ======================
describe('handleApplyPatchTool', () => {
  it('rejects write when file hash changed during approval', async () => {
    let readCount = 0;
    const deps = makeDeps({
      parseUnifiedDiff: () => [{ oldPath: 'src/a.ts', newPath: 'src/a.ts', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }] }],
      applyUnifiedDiffToText: () => ({ text: 'new content', appliedHunks: 1, totalHunks: 1 }),
      readFileForTool: async () => {
        readCount++;
        // First read: original file content
        // Second read (pre-approval hash): hash_v1
        // Third read (pre-write check): hash_v2 — changed!
        if (readCount <= 2) return { text: 'old content', size: 11, hash: 'hash_v1' };
        return { text: 'externally modified', size: 20, hash: 'hash_v2' };
      },
      showDiffAndConfirm: async () => true,
    });
    // stat succeeds so file "exists"
    vscodeMock.workspace.fs.stat = async () => ({ type: 1 });
    const result = await handleApplyPatchTool(
      'apply_patch',
      { diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new' },
      true, // confirmEdits
      { edit: false, commands: false }, // not auto-approved
      deps
    );
    expect(result.ok).to.be.false;
    expect(result.message).to.include('zmenil behem schvalovani');
  });

  it('applies patch when hash is stable during approval', async () => {
    const deps = makeDeps({
      parseUnifiedDiff: () => [{ oldPath: 'src/b.ts', newPath: 'src/b.ts', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }] }],
      applyUnifiedDiffToText: () => ({ text: 'new content', appliedHunks: 1, totalHunks: 1 }),
      readFileForTool: async () => ({ text: 'old content', size: 11, hash: 'stable_hash' }),
      showDiffAndConfirm: async () => true,
      applyFileContent: async () => true,
    });
    vscodeMock.workspace.fs.stat = async () => ({ type: 1 });
    const result = await handleApplyPatchTool(
      'apply_patch',
      { diff: '--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-old\n+new' },
      true,
      { edit: false, commands: false },
      deps
    );
    expect(result.ok).to.be.true;
    expect(result.approved).to.be.true;
  });
});
