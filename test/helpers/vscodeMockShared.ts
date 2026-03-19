// Shared vscode mock singleton for all toolHandler test files.
// Both coreHandlers and extractedHandlers import this to get the SAME object,
// ensuring mock-require caches toolHandlers.ts with a single vscode binding.
const path = require('path');

const vscodeMock: any = {
  workspace: {
    findFiles: async () => [],
    getConfiguration: (_section?: string) => ({
      get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
      has: () => false,
      inspect: () => undefined,
      update: async () => {}
    }),
    fs: {
      stat: async () => ({ type: 0 }),
      createDirectory: async () => {},
      writeFile: async () => {}
    },
    openTextDocument: async (arg: any) => {
      if (arg && typeof arg === 'object' && 'content' in arg) {
        return { uri: { fsPath: 'preview' }, getText: () => String(arg.content) };
      }
      return { uri: arg, getText: () => '' };
    },
    asRelativePath: (value: any) => {
      if (!value) return '';
      const fsPath = typeof value === 'string' ? value : value.fsPath;
      return String(fsPath).replace(/^[A-Za-z]:[\\/]/, '').replace(/\\/g, '/');
    }
  },
  window: {
    activeTextEditor: undefined as any,
    visibleTextEditors: [] as any[],
    showTextDocument: async () => {},
    showInformationMessage: async () => 'Vytvorit'
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath: path.normalize(fsPath) }),
    joinPath: (base: any, ...segments: string[]) => ({ fsPath: path.join(base.fsPath, ...segments) })
  },
  Position: function MockPosition(line: number, character: number) {
    return { line, character };
  },
  Range: function MockRange(startLine: number, startChar: number, endLine: number, endChar: number) {
    return { start: { line: startLine, character: startChar }, end: { line: endLine, character: endChar } };
  },
  Location: function MockLocation(uri: any, range: any) {
    return { uri, range };
  },
  languages: {
    getDiagnostics: () => []
  },
  commands: {
    executeCommand: async () => undefined
  },
  SymbolKind: (() => {
    const sk: Record<string | number, string | number> = {
      0: 'File', 1: 'Module', 2: 'Namespace', 4: 'Class',
      5: 'Method', 6: 'Property', 11: 'Function', 12: 'Variable',
      13: 'Constant', 22: 'Struct', 23: 'Event'
    };
    for (const [k, v] of Object.entries(sk)) {
      if (typeof v === 'string') sk[v] = Number(k);
    }
    return sk;
  })(),
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 }
};

module.exports = { vscodeMock };

// Attach FileSystemError class for instanceof checks
class FileSystemError extends Error {
  code: string;
  constructor(message?: string) {
    super(message);
    this.code = '';
  }
  static FileNotFound(messageOrUri?: any): FileSystemError {
    const e = new FileSystemError(String(messageOrUri ?? 'FileNotFound'));
    e.code = 'FileNotFound';
    return e;
  }
}
vscodeMock.FileSystemError = FileSystemError;
