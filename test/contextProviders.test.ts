const { vscodeMock, registerMock, flushModuleCache } = require('./helpers/mockLoader');
registerMock('workspace', { workspaceIndexer: { getIndex: () => null } }, 'contextProviders');

// Flush cache so contextProviders is freshly loaded through the mock hook
flushModuleCache('../src/contextProviders');

const { expect } = require('chai');
const { ContextProviderRegistry, DEFAULT_CONTEXT_PROVIDERS, setContextProviderLogger } = require('../src/contextProviders');

describe('contextProviders', () => {

  // ── DEFAULT_CONTEXT_PROVIDERS ──────────────────────────────
  describe('DEFAULT_CONTEXT_PROVIDERS', () => {
    it('contains expected provider names', () => {
      expect(DEFAULT_CONTEXT_PROVIDERS).to.include.members([
        'workspace', 'file', 'code', 'diff', 'terminal', 'docs', 'web'
      ]);
    });

    it('has 7 providers', () => {
      expect(DEFAULT_CONTEXT_PROVIDERS).to.have.lengthOf(7);
    });
  });

  // ── ContextProviderRegistry.collect ────────────────────────
  describe('ContextProviderRegistry.collect', () => {
    it('returns empty string when all providers return null', async () => {
      const reg = new ContextProviderRegistry();
      // Default providers need vscode mocks; terminal/docs/web always return null
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['terminal', 'docs', 'web'],
        tokenBudget: 1024,
        workspaceIndexEnabled: false
      });
      expect(result).to.equal('');
    });

    it('collects output from custom registered provider', async () => {
      const reg = new ContextProviderRegistry();
      reg.register('workspace', async () => ({ name: 'workspace', content: 'MOCK_WORKSPACE_CONTENT' }));
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['workspace'],
        tokenBudget: 1024,
        workspaceIndexEnabled: true
      });
      expect(result).to.include('[CONTEXT:workspace]');
      expect(result).to.include('MOCK_WORKSPACE_CONTENT');
    });

    it('collects from multiple providers in order', async () => {
      const reg = new ContextProviderRegistry();
      reg.register('workspace', async () => ({ name: 'workspace', content: 'WS' }));
      reg.register('file', async () => ({ name: 'file', content: 'FILE' }));
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['workspace', 'file'],
        tokenBudget: 4096,
        workspaceIndexEnabled: true
      });
      expect(result).to.include('[CONTEXT:workspace]');
      expect(result).to.include('[CONTEXT:file]');
      const wsIdx = result.indexOf('[CONTEXT:workspace]');
      const fileIdx = result.indexOf('[CONTEXT:file]');
      expect(wsIdx).to.be.lessThan(fileIdx);
    });

    it('skips unknown provider names gracefully', async () => {
      const reg = new ContextProviderRegistry();
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['nonexistent' as any],
        tokenBudget: 1024,
        workspaceIndexEnabled: false
      });
      expect(result).to.equal('');
    });

    it('skips providers that return empty content', async () => {
      const reg = new ContextProviderRegistry();
      reg.register('workspace', async () => ({ name: 'workspace', content: '   ' }));
      reg.register('file', async () => ({ name: 'file', content: 'real content' }));
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['workspace', 'file'],
        tokenBudget: 1024,
        workspaceIndexEnabled: true
      });
      expect(result).not.to.include('[CONTEXT:workspace]');
      expect(result).to.include('[CONTEXT:file]');
    });

    it('truncates when output exceeds token budget', async () => {
      const reg = new ContextProviderRegistry();
      const longContent = 'X'.repeat(5000);
      reg.register('workspace', async () => ({ name: 'workspace', content: longContent }));
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['workspace'],
        tokenBudget: 256,  // 256 * 4 = 1024 chars
        workspaceIndexEnabled: true
      });
      expect(result.length).to.be.lessThan(longContent.length);
    });

    it('falls back to DEFAULT_CONTEXT_PROVIDERS when enabled is empty', async () => {
      const reg = new ContextProviderRegistry();
      reg.register('workspace', async () => ({ name: 'workspace', content: 'FOUND' }));
      const result = await reg.collect({
        prompt: 'test',
        enabled: [],
        tokenBudget: 1024,
        workspaceIndexEnabled: true
      });
      // Should use all default providers, workspace is first
      expect(result).to.include('[CONTEXT:workspace]');
    });

    it('stops collecting when budget is exhausted', async () => {
      const reg = new ContextProviderRegistry();
      // Each provider returns 800 chars
      const bigContent = 'Y'.repeat(800);
      reg.register('workspace', async () => ({ name: 'workspace', content: bigContent }));
      reg.register('file', async () => ({ name: 'file', content: bigContent }));
      reg.register('code', async () => ({ name: 'code', content: 'SHOULD_NOT_APPEAR' }));
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['workspace', 'file', 'code'],
        tokenBudget: 256,  // 1024 chars
        workspaceIndexEnabled: true
      });
      // With 1024 budget, workspace + file blocks may exhaust budget
      // code should be dropped or heavily truncated
      expect(result).to.include('[CONTEXT:workspace]');
    });

    it('skips a provider that throws and continues to next', async () => {
      const reg = new ContextProviderRegistry();
      reg.register('workspace', async () => { throw new Error('provider crash'); });
      reg.register('file', async () => ({ name: 'file', content: 'OK_CONTENT' }));
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['workspace', 'file'],
        tokenBudget: 1024,
        workspaceIndexEnabled: true
      });
      expect(result).not.to.include('[CONTEXT:workspace]');
      expect(result).to.include('[CONTEXT:file]');
      expect(result).to.include('OK_CONTENT');
    });

    it('returns empty when all providers throw', async () => {
      const reg = new ContextProviderRegistry();
      reg.register('workspace', async () => { throw new Error('crash1'); });
      reg.register('file', async () => { throw new Error('crash2'); });
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['workspace', 'file'],
        tokenBudget: 1024,
        workspaceIndexEnabled: true
      });
      expect(result).to.equal('');
    });

    it('gives last provider fair budget share (remaining-count division)', async () => {
      const reg = new ContextProviderRegistry();
      // Provider A returns null, provider B should get the full budget
      reg.register('workspace', async () => null);
      reg.register('file', async (ctx: any) => {
        // The last provider should receive maxChars = entire budget, not budget/2
        return { name: 'file', content: 'B'.repeat(Math.min(ctx.maxChars, 2000)) };
      });
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['workspace', 'file'],
        tokenBudget: 512,  // 2048 chars total
        workspaceIndexEnabled: true
      });
      // With remaining-count division, file gets full remaining budget
      const fileBlock = result.match(/\[CONTEXT:file\]\n(B+)/);
      expect(fileBlock).to.not.be.null;
      // Budget is 2048 chars. Provider B should get close to full budget
      expect(fileBlock![1].length).to.be.greaterThan(1024);
    });
  });

  // ── ContextProviderRegistry.register ───────────────────────
  describe('ContextProviderRegistry.register', () => {
    it('overrides a default provider', async () => {
      const reg = new ContextProviderRegistry();
      reg.register('terminal', async () => ({ name: 'terminal', content: 'CUSTOM_TERMINAL' }));
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['terminal'],
        tokenBudget: 1024,
        workspaceIndexEnabled: false
      });
      expect(result).to.include('CUSTOM_TERMINAL');
    });
  });

  // ── workspace provider (default) ──────────────────────────
  describe('workspace provider (built-in)', () => {
    it('returns null when workspaceIndexEnabled is false', async () => {
      const reg = new ContextProviderRegistry();
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['workspace'],
        tokenBudget: 1024,
        workspaceIndexEnabled: false
      });
      expect(result).to.equal('');
    });
  });

  // ── file provider (built-in) ──────────────────────────────
  describe('file provider (built-in)', () => {
    afterEach(() => {
      vscodeMock.window.activeTextEditor = undefined;
    });

    it('returns null when no active editor', async () => {
      vscodeMock.window.activeTextEditor = undefined;
      const reg = new ContextProviderRegistry();
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['file'],
        tokenBudget: 1024,
        workspaceIndexEnabled: false
      });
      expect(result).to.equal('');
    });

    it('returns file context when editor is active', async () => {
      vscodeMock.window.activeTextEditor = {
        document: {
          uri: { fsPath: 'C:/repo/src/main.ts' },
          getText: () => 'console.log("hello")',
          isDirty: false
        },
        selection: { isEmpty: true }
      };
      const reg = new ContextProviderRegistry();
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['file'],
        tokenBudget: 1024,
        workspaceIndexEnabled: false
      });
      expect(result).to.include('[CONTEXT:file]');
      expect(result).to.include('console.log');
    });
  });

  // ── code provider (built-in, selection) ───────────────────
  describe('code provider (built-in)', () => {
    afterEach(() => {
      vscodeMock.window.activeTextEditor = undefined;
    });

    it('returns null when selection is empty', async () => {
      vscodeMock.window.activeTextEditor = {
        document: {
          uri: { fsPath: 'C:/repo/file.ts' },
          getText: (_sel?: any) => '',
          isDirty: false
        },
        selection: { isEmpty: true }
      };
      const reg = new ContextProviderRegistry();
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['code'],
        tokenBudget: 1024,
        workspaceIndexEnabled: false
      });
      expect(result).to.equal('');
    });

    it('returns selected code when selection exists', async () => {
      vscodeMock.window.activeTextEditor = {
        document: {
          uri: { fsPath: 'C:/repo/file.ts' },
          getText: (sel?: any) => sel ? 'let x = 42;' : 'full file',
          isDirty: false
        },
        selection: { isEmpty: false }
      };
      const reg = new ContextProviderRegistry();
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['code'],
        tokenBudget: 1024,
        workspaceIndexEnabled: false
      });
      expect(result).to.include('[CONTEXT:code]');
      expect(result).to.include('let x = 42');
    });
  });

  // ── diff provider (built-in) ──────────────────────────────
  describe('diff provider (built-in)', () => {
    afterEach(() => {
      vscodeMock.window.activeTextEditor = undefined;
    });

    it('returns null when document is not dirty', async () => {
      vscodeMock.window.activeTextEditor = {
        document: {
          uri: { fsPath: 'C:/repo/clean.ts' },
          getText: () => '',
          isDirty: false
        },
        selection: { isEmpty: true }
      };
      const reg = new ContextProviderRegistry();
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['diff'],
        tokenBudget: 1024,
        workspaceIndexEnabled: false
      });
      expect(result).to.equal('');
    });

    it('returns diff context when document is dirty', async () => {
      vscodeMock.window.activeTextEditor = {
        document: {
          uri: { fsPath: 'C:/repo/dirty.ts' },
          getText: () => 'modified content',
          isDirty: true
        },
        selection: { isEmpty: true }
      };
      const reg = new ContextProviderRegistry();
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['diff'],
        tokenBudget: 1024,
        workspaceIndexEnabled: false
      });
      expect(result).to.include('[CONTEXT:diff]');
      expect(result).to.include('DIRTY_FILE');
    });
  });

  // ── provider error logging ────────────────────────────────
  describe('provider error logging', () => {
    afterEach(() => {
      setContextProviderLogger(undefined);
    });

    it('logs provider errors to the output channel', async () => {
      const logs: string[] = [];
      setContextProviderLogger({ appendLine: (msg: string) => logs.push(msg) });

      const reg = new ContextProviderRegistry();
      reg.register('workspace', async () => { throw new Error('test provider crash'); });
      reg.register('file', async () => ({ name: 'file', content: 'OK' }));
      await reg.collect({
        prompt: 'test',
        enabled: ['workspace', 'file'],
        tokenBudget: 1024,
        workspaceIndexEnabled: true
      });

      expect(logs).to.have.lengthOf(1);
      expect(logs[0]).to.include('workspace');
      expect(logs[0]).to.include('test provider crash');
    });

    it('does not crash when logger is not set', async () => {
      setContextProviderLogger(undefined);
      const reg = new ContextProviderRegistry();
      reg.register('workspace', async () => { throw new Error('no logger'); });
      const result = await reg.collect({
        prompt: 'test',
        enabled: ['workspace'],
        tokenBudget: 1024,
        workspaceIndexEnabled: true
      });
      expect(result).to.equal('');
    });
  });
});
