// Shared Module._load hook for mocking 'vscode' and other modules in test files.
// Replaces broken mock-require on Node 24 (getCallerFile() returns null).
//
// The hook only intercepts requests from src/ modules, so test files that set
// their own mocks via mock-require (e.g., logger.test.ts) are not affected.
//
// Usage:
//   const { vscodeMock, registerMock, flushModuleCache } = require('./helpers/mockLoader');
//   registerMock('toolHandlers', handlersMock, 'toolExecution');
//   flushModuleCache('../src/myModule');
//   const { fn } = require('../src/myModule');

const Module = require('module');
const path = require('path');
const { vscodeMock } = require('./vscodeMockShared');

const HOOKED = Symbol.for('__shumilek_mock_hooked__');
const srcDir = path.resolve(__dirname, '..', '..', 'src') + path.sep;

interface MockEntry {
  mock: unknown;
  /** Only intercept when the parent filename contains this substring. */
  parentFilter?: string;
}

const extraMocks = new Map<string, MockEntry>();

function registerMock(moduleId: string, mockValue: unknown, parentFilter?: string) {
  extraMocks.set(moduleId, { mock: mockValue, parentFilter });
}

function unregisterMock(moduleId: string) {
  extraMocks.delete(moduleId);
}

/** Flush a module from require.cache so it gets freshly loaded through the hook. */
function flushModuleCache(moduleId: string) {
  try {
    const resolved = require.resolve(moduleId);
    delete require.cache[resolved];
  } catch { /* module not yet loaded — ok */ }
}

if (!(Module as any)[HOOKED]) {
  const originalLoad = Module._load;
  Module._load = function (request: string, parent: any, ...rest: any[]) {
    const parentFile: string = parent?.filename ?? '';
    const isSrcParent = parentFile.startsWith(srcDir);

    // Extra mocks — check against registered entries
    for (const [pattern, entry] of extraMocks.entries()) {
      const matches = request === pattern
        || request === './' + pattern
        || request.endsWith('/' + pattern);
      if (matches) {
        if (!entry.parentFilter || parentFile.includes(entry.parentFilter)) {
          return entry.mock;
        }
      }
    }

    // Mock 'vscode' only for src/ modules — leaves test-specific mocks untouched
    if (request === 'vscode' && isSrcParent) {
      return vscodeMock;
    }

    return originalLoad.call(this, request, parent, ...rest);
  };
  (Module as any)[HOOKED] = true;
}

module.exports = { vscodeMock, registerMock, unregisterMock, flushModuleCache };
