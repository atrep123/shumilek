// Shared vscode mock singleton for all toolHandler test files.
// Both coreHandlers and extractedHandlers import this to get the SAME object,
// ensuring mock-require caches toolHandlers.ts with a single vscode binding.
const path = require('path');

const vscodeMock: any = {
  workspace: {
    findFiles: async () => [],
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
    showTextDocument: async () => {},
    showInformationMessage: async () => 'Vytvorit'
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath: path.normalize(fsPath) })
  }
};

module.exports = { vscodeMock };
