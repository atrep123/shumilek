const mock = require('mock-require');
const path = require('path');
const { strict: assert } = require('assert');

// Import the shared vscode mock — same object used by coreHandlers
const { vscodeMock } = require('./helpers/vscodeMockShared');
mock('vscode', vscodeMock);

const {
  handleApplyPatchTool,
  handlePickSavePathTool,
  handleRouteFileTool
} = require('../src/toolHandlers');

describe('toolHandlers extracted handlers', () => {
  it('route_file picks best matching existing file', async () => {
    vscodeMock.workspace.findFiles = async () => [
      { fsPath: 'C:/repo/src/foo.ts' },
      { fsPath: 'C:/repo/src/bar.ts' }
    ];

    const deps = {
      asString: (value: unknown) => typeof value === 'string' ? value : undefined,
      clampNumber: (value: unknown, fallback: number, min: number, max: number) => {
        if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
        return Math.min(max, Math.max(min, value));
      },
      normalizeExtension: (ext: string | undefined) => {
        if (!ext) return '';
        const low = String(ext).toLowerCase();
        return low.startsWith('.') ? low : `.${low}`;
      },
      normalizeRouteText: (input: string) => String(input).toLowerCase(),
      tokenizeRouteText: (input: string) => String(input).toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length >= 2),
      getActiveWorkspaceFileUri: () => undefined,
      getRelativePathForWorkspace: (uri: { fsPath: string }) => uri.fsPath.replace('C:/repo/', ''),
      BINARY_EXTENSIONS: new Set(['.png', '.jpg']),
      DEFAULT_EXCLUDE_GLOB: '**/{node_modules,.git}/**',
      buildAutoFileName: () => 'auto.ts',
      resolveAutoSaveTargetUri: async () => ({ uri: { fsPath: 'C:/repo/auto/auto.ts' } })
    };

    const result = await handleRouteFileTool(
      'route_file',
      { intent: 'update foo', fileNameHint: 'foo.ts', preferredExtension: 'ts', allowCreate: false },
      deps
    );

    assert.equal(result.ok, true);
    assert.equal((result.data as any).bestPath, 'src/foo.ts');
    assert.ok(Array.isArray((result.data as any).candidates));
    assert.equal((result.data as any).candidates[0].path, 'src/foo.ts');
  });

  it('route_file can fallback to auto-save path when no candidates', async () => {
    vscodeMock.workspace.findFiles = async () => [];

    const deps = {
      asString: (value: unknown) => typeof value === 'string' ? value : undefined,
      clampNumber: (value: unknown, fallback: number, min: number, max: number) => {
        if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
        return Math.min(max, Math.max(min, value));
      },
      normalizeExtension: (ext: string | undefined) => (typeof ext === 'string' && ext ? (ext.startsWith('.') ? ext : `.${ext}`) : ''),
      normalizeRouteText: (input: string) => String(input).toLowerCase(),
      tokenizeRouteText: () => [],
      getActiveWorkspaceFileUri: () => undefined,
      getRelativePathForWorkspace: (uri: { fsPath: string }) => uri.fsPath.replace('C:/repo/', ''),
      BINARY_EXTENSIONS: new Set(['.png']),
      DEFAULT_EXCLUDE_GLOB: '**/{node_modules,.git}/**',
      buildAutoFileName: () => 'note.md',
      resolveAutoSaveTargetUri: async () => ({ uri: { fsPath: 'C:/repo/.shumilek/note.md' } })
    };

    const result = await handleRouteFileTool('route_file', { intent: 'write notes' }, deps);

    assert.equal(result.ok, true);
    assert.equal((result.data as any).bestPath, '.shumilek/note.md');
    assert.equal((result.data as any).autoSavePath, '.shumilek/note.md');
  });

  it('pick_save_path returns path, fileName and folder', async () => {
    const deps = {
      asString: (value: unknown) => typeof value === 'string' ? value : undefined,
      buildAutoFileName: () => 'report.md',
      resolveAutoSaveTargetUri: async () => ({ uri: { fsPath: 'C:/repo/out/report.md' } }),
      getRelativePathForWorkspace: (uri: { fsPath: string }) => uri.fsPath.replace('C:/repo/', '')
    };

    const result = await handlePickSavePathTool('pick_save_path', { title: 'Report' }, deps);

    assert.equal(result.ok, true);
    assert.equal((result.data as any).path, 'out/report.md');
    assert.equal((result.data as any).fileName, 'report.md');
    assert.match(String((result.data as any).folder).replace(/\\/g, '/'), /(^|\/)out$/);
  });

  it('apply_patch rejects missing diff payload', async () => {
    const result = await handleApplyPatchTool(
      'apply_patch',
      {},
      false,
      { edit: false, commands: false },
      {
        getFirstStringArg: () => undefined
      }
    );

    assert.equal(result.ok, false);
    assert.match(String(result.message), /diff je povinny/i);
  });

  it('apply_patch rejects invalid parsed diff', async () => {
    const result = await handleApplyPatchTool(
      'apply_patch',
      { diff: 'invalid' },
      false,
      { edit: false, commands: false },
      {
        getFirstStringArg: () => 'invalid',
        parseUnifiedDiff: () => []
      }
    );

    assert.equal(result.ok, false);
    assert.match(String(result.message), /neplatny diff/i);
  });

  it('apply_patch updates existing file and records mutation', async () => {
    vscodeMock.workspace.fs.stat = async () => ({ type: 0 });

    const lastReadHashes = new Map<string, { hash: string; updatedAt: number }>();
    const calls = {
      mark: 0,
      write: 0,
      notify: 0
    };
    const session = { hadMutations: false, mutationTools: [] as string[] };

    const deps = {
      getFirstStringArg: () => '--- a/src/a.ts\n+++ b/src/a.ts',
      parseUnifiedDiff: () => [
        {
          oldPath: 'src/a.ts',
          newPath: 'src/a.ts',
          hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }]
        }
      ],
      getToolsAutoOpenAutoSaveSetting: () => false,
      getToolsAutoOpenOnWriteSetting: () => false,
      isBinaryExtension: () => false,
      resolveWorkspaceUri: async () => ({ uri: { fsPath: 'C:/repo/src/a.ts' } }),
      readFileForTool: async () => ({ text: 'old', size: 3 }),
      DEFAULT_MAX_WRITE_BYTES: 1024,
      applyUnifiedDiffToText: () => ({ text: 'new', appliedHunks: 1, totalHunks: 1 }),
      getRelativePathForWorkspace: (uri: { fsPath: string }) => uri.fsPath.replace('C:/repo/', ''),
      showDiffAndConfirm: async () => true,
      applyFileContent: async () => true,
      markToolMutation: () => { calls.mark += 1; session.hadMutations = true; },
      recordToolWrite: () => { calls.write += 1; },
      computeContentHash: () => 'hash-new',
      lastReadHashes,
      isInAutoSaveDir: () => false,
      revealWrittenDocument: async () => {},
      notifyToolWrite: async () => { calls.notify += 1; }
    };

    const result = await handleApplyPatchTool(
      'apply_patch',
      { diff: 'valid' },
      false,
      { edit: false, commands: false },
      deps,
      session
    );

    assert.equal(result.ok, true);
    assert.equal(result.approved, true);
    assert.equal((result.data as any).files.length, 1);
    assert.equal((result.data as any).files[0].action, 'updated');
    assert.equal(calls.mark, 1);
    assert.equal(calls.write, 1);
    assert.equal(calls.notify, 1);
    assert.equal(session.hadMutations, true);
    assert.equal(lastReadHashes.get('C:/repo/src/a.ts')?.hash, 'hash-new');
  });
});
