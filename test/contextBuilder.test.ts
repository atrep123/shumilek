import { expect } from 'chai';
const mock = require('mock-require');
const { vscodeMock } = require('./helpers/vscodeMockShared');
mock('vscode', vscodeMock);

import {
  truncateTextByBytes,
  extractImportPaths,
  buildSimpleDiff,
  isTestFileName,
  isWithinWorkspace,
  isFileNotFoundError,
  getRelativePathForWorkspace,
  getOpenTextDocuments,
  DEFAULT_EXCLUDE_GLOB,
  DEFAULT_MAX_WARM_FILES,
  DEFAULT_MAX_EDITOR_FILES,
  DEFAULT_MAX_DIFF_LINES
} from '../src/contextBuilder';

describe('contextBuilder', () => {
  // ── constants ──────────────────────────────────────────────
  describe('constants', () => {
    it('should export DEFAULT_EXCLUDE_GLOB', () => {
      expect(DEFAULT_EXCLUDE_GLOB).to.be.a('string');
      expect(DEFAULT_EXCLUDE_GLOB).to.include('node_modules');
      expect(DEFAULT_EXCLUDE_GLOB).to.include('.git');
    });

    it('should have sensible default limits', () => {
      expect(DEFAULT_MAX_WARM_FILES).to.be.a('number').and.be.greaterThan(0);
      expect(DEFAULT_MAX_EDITOR_FILES).to.be.a('number').and.be.greaterThan(0);
      expect(DEFAULT_MAX_DIFF_LINES).to.be.a('number').and.be.greaterThan(0);
    });
  });

  // ── truncateTextByBytes ────────────────────────────────────
  describe('truncateTextByBytes', () => {
    it('should return text unchanged when within limit', () => {
      const result = truncateTextByBytes('hello', 100);
      expect(result).to.deep.equal({ text: 'hello', truncated: false });
    });

    it('should truncate text exceeding byte limit', () => {
      const text = 'a'.repeat(100);
      const result = truncateTextByBytes(text, 50);
      expect(result.truncated).to.be.true;
      expect(Buffer.byteLength(result.text, 'utf8')).to.be.at.most(50);
    });

    it('should handle empty string', () => {
      const result = truncateTextByBytes('', 10);
      expect(result).to.deep.equal({ text: '', truncated: false });
    });

    it('should handle multibyte characters correctly', () => {
      // Czech characters with diacritics
      const text = 'Šumílek říká čau';
      const byteLen = Buffer.byteLength(text, 'utf8');
      const result = truncateTextByBytes(text, byteLen);
      expect(result.truncated).to.be.false;
      expect(result.text).to.equal(text);
    });

    it('should truncate multibyte without breaking', () => {
      const text = 'aaaa';
      const result = truncateTextByBytes(text, 2);
      expect(result.truncated).to.be.true;
      expect(Buffer.byteLength(result.text, 'utf8')).to.be.at.most(2);
    });

    it('should handle exact boundary', () => {
      const text = 'abc';
      const result = truncateTextByBytes(text, 3);
      expect(result).to.deep.equal({ text: 'abc', truncated: false });
    });
  });

  // ── extractImportPaths ─────────────────────────────────────
  describe('extractImportPaths', () => {
    it('should extract ES module imports', () => {
      const text = `import { foo } from './foo';\nimport bar from '../bar';`;
      const paths = extractImportPaths(text);
      expect(paths).to.include('./foo');
      expect(paths).to.include('../bar');
    });

    it('should extract require calls', () => {
      const text = `const x = require('lodash');\nconst y = require('./local');`;
      const paths = extractImportPaths(text);
      expect(paths).to.include('lodash');
      expect(paths).to.include('./local');
    });

    it('should extract mixed imports and requires', () => {
      const text = `import a from 'a';\nconst b = require('b');`;
      const paths = extractImportPaths(text);
      expect(paths).to.have.lengthOf(2);
      expect(paths).to.include('a');
      expect(paths).to.include('b');
    });

    it('should deduplicate paths', () => {
      const text = `import a from './a';\nimport b from './a';`;
      const paths = extractImportPaths(text);
      expect(paths).to.have.lengthOf(1);
    });

    it('should return empty array for no imports', () => {
      const paths = extractImportPaths('const x = 42;');
      expect(paths).to.deep.equal([]);
    });

    it('should handle single-quoted and double-quoted paths', () => {
      const text = `import a from "double";\nconst b = require('single');`;
      const paths = extractImportPaths(text);
      expect(paths).to.include('double');
      expect(paths).to.include('single');
    });
  });

  // ── buildSimpleDiff ────────────────────────────────────────
  describe('buildSimpleDiff', () => {
    it('should return empty diff for identical text', () => {
      const result = buildSimpleDiff('hello', 'hello', 100);
      expect(result).to.deep.equal({ diff: '', truncated: false });
    });

    it('should show added lines', () => {
      const result = buildSimpleDiff('line1\nline2', 'line1\nline2\nline3', 100);
      expect(result.diff).to.include('+line3');
      expect(result.truncated).to.be.false;
    });

    it('should show removed lines', () => {
      const result = buildSimpleDiff('line1\nline2\nline3', 'line1\nline3', 100);
      expect(result.diff).to.include('-line2');
    });

    it('should show changed lines', () => {
      const result = buildSimpleDiff('old line', 'new line', 100);
      expect(result.diff).to.include('-old line');
      expect(result.diff).to.include('+new line');
    });

    it('should truncate long diffs', () => {
      const old = Array.from({ length: 50 }, (_, i) => `old-${i}`).join('\n');
      const nw = Array.from({ length: 50 }, (_, i) => `new-${i}`).join('\n');
      const result = buildSimpleDiff(old, nw, 5);
      expect(result.truncated).to.be.true;
      expect(result.diff).to.include('... truncated');
    });

    it('should include hunk header', () => {
      const result = buildSimpleDiff('a', 'b', 100);
      expect(result.diff).to.match(/^@@.*@@/);
    });
  });

  // ── isTestFileName ─────────────────────────────────────────
  describe('isTestFileName', () => {
    it('should detect .test. files', () => {
      expect(isTestFileName('foo.test.ts')).to.be.true;
      expect(isTestFileName('bar.test.js')).to.be.true;
    });

    it('should detect .spec. files', () => {
      expect(isTestFileName('foo.spec.ts')).to.be.true;
    });

    it('should be case-insensitive', () => {
      expect(isTestFileName('foo.TEST.ts')).to.be.true;
      expect(isTestFileName('foo.Spec.ts')).to.be.true;
    });

    it('should reject non-test files', () => {
      expect(isTestFileName('foo.ts')).to.be.false;
      expect(isTestFileName('test.ts')).to.be.false;
      expect(isTestFileName('tests.js')).to.be.false;
    });
  });

  // ── isWithinWorkspace ──────────────────────────────────────
  describe('isWithinWorkspace', () => {
    it('should return false when no workspace folders', () => {
      const orig = vscodeMock.workspace.workspaceFolders;
      vscodeMock.workspace.workspaceFolders = undefined;
      const result = isWithinWorkspace({ fsPath: '/some/file.ts' } as any);
      expect(result).to.be.false;
      vscodeMock.workspace.workspaceFolders = orig;
    });

    it('should return false for empty folders array', () => {
      const orig = vscodeMock.workspace.workspaceFolders;
      vscodeMock.workspace.workspaceFolders = [];
      const result = isWithinWorkspace({ fsPath: '/some/file.ts' } as any);
      expect(result).to.be.false;
      vscodeMock.workspace.workspaceFolders = orig;
    });
  });

  // ── isFileNotFoundError ────────────────────────────────────
  describe('isFileNotFoundError', () => {
    it('should detect FileNotFound code', () => {
      expect(isFileNotFoundError({ code: 'FileNotFound' })).to.be.true;
    });

    it('should return false for other errors', () => {
      expect(isFileNotFoundError({ code: 'ENOENT' })).to.be.false;
      expect(isFileNotFoundError(new Error('oops'))).to.be.false;
    });

    it('should return false for null/undefined', () => {
      expect(isFileNotFoundError(null)).to.be.false;
      expect(isFileNotFoundError(undefined)).to.be.false;
    });
  });

  // ── getRelativePathForWorkspace ────────────────────────────
  describe('getRelativePathForWorkspace', () => {
    it('should call asRelativePath', () => {
      const uri = { fsPath: '/workspace/src/file.ts' };
      const result = getRelativePathForWorkspace(uri as any);
      expect(result).to.be.a('string');
    });
  });

  // ── getOpenTextDocuments ───────────────────────────────────
  describe('getOpenTextDocuments', () => {
    it('should return empty when no active editor and no visible editors', () => {
      const origActive = vscodeMock.window.activeTextEditor;
      const origVisibleEditors = vscodeMock.window.visibleTextEditors;
      vscodeMock.window.activeTextEditor = undefined;
      vscodeMock.window.visibleTextEditors = [];
      const docs = getOpenTextDocuments();
      expect(docs).to.be.an('array').with.lengthOf(0);
      vscodeMock.window.activeTextEditor = origActive;
      vscodeMock.window.visibleTextEditors = origVisibleEditors;
    });

    it('should include active editor document first', () => {
      const origActive = vscodeMock.window.activeTextEditor;
      const origVisibleEditors = vscodeMock.window.visibleTextEditors;
      const mockDoc = { uri: { toString: () => 'file:///test.ts' } };
      vscodeMock.window.activeTextEditor = { document: mockDoc };
      vscodeMock.window.visibleTextEditors = [];
      const docs = getOpenTextDocuments();
      expect(docs).to.have.lengthOf(1);
      expect(docs[0]).to.equal(mockDoc);
      vscodeMock.window.activeTextEditor = origActive;
      vscodeMock.window.visibleTextEditors = origVisibleEditors;
    });

    it('should deduplicate active and visible editor documents', () => {
      const origActive = vscodeMock.window.activeTextEditor;
      const origVisibleEditors = vscodeMock.window.visibleTextEditors;
      const mockDoc = { uri: { toString: () => 'file:///same.ts' } };
      vscodeMock.window.activeTextEditor = { document: mockDoc };
      vscodeMock.window.visibleTextEditors = [{ document: mockDoc }];
      const docs = getOpenTextDocuments();
      expect(docs).to.have.lengthOf(1);
      vscodeMock.window.activeTextEditor = origActive;
      vscodeMock.window.visibleTextEditors = origVisibleEditors;
    });

    it('should include multiple visible editors', () => {
      const origActive = vscodeMock.window.activeTextEditor;
      const origVisibleEditors = vscodeMock.window.visibleTextEditors;
      const doc1 = { uri: { toString: () => 'file:///a.ts' } };
      const doc2 = { uri: { toString: () => 'file:///b.ts' } };
      vscodeMock.window.activeTextEditor = undefined;
      vscodeMock.window.visibleTextEditors = [{ document: doc1 }, { document: doc2 }];
      const docs = getOpenTextDocuments();
      expect(docs).to.have.lengthOf(2);
      vscodeMock.window.activeTextEditor = origActive;
      vscodeMock.window.visibleTextEditors = origVisibleEditors;
    });
  });
});
