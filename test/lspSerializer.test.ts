const mock = require('mock-require');

// Minimal vscode mock for lspSerializer
const SymbolKind: Record<number, string> = {
  0: 'File', 1: 'Module', 2: 'Namespace', 4: 'Class',
  5: 'Method', 6: 'Property', 11: 'Function', 12: 'Variable',
  13: 'Constant', 22: 'Struct', 23: 'Event'
};
// Reverse map (string -> number) for vscode.SymbolKind behavior
for (const [k, v] of Object.entries(SymbolKind)) {
  (SymbolKind as any)[v] = Number(k);
}
const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };

function MockPosition(line: number, character: number) {
  return { line, character };
}
function MockRange(startLine: number, startChar: number, endLine: number, endChar: number) {
  return { start: MockPosition(startLine, startChar), end: MockPosition(endLine, endChar) };
}
function MockUri(fsPath: string) {
  return { fsPath, scheme: 'file', toString() { return fsPath; } };
}
function MockLocation(uri: any, range: any) {
  return { uri, range };
}

mock('vscode', {
  SymbolKind,
  DiagnosticSeverity,
  Position: MockPosition,
  Range: MockRange,
  Uri: MockUri,
  Location: MockLocation,
  workspace: { getConfiguration: () => ({ get: (_k: string, d: any) => d }) },
  commands: { executeCommand: async () => [] }
});

import { expect } from 'chai';
import {
  serializeRange,
  serializeSymbolKind,
  serializeLocationInfo,
  renderHoverContents,
  serializeDiagnosticSeverity,
  collectDocumentSymbols,
  collectSymbolInformation,
  getPositionFromArgs,
  RangeInfo
} from '../src/lspSerializer';

describe('lspSerializer', () => {
  // ======================================
  // serializeRange
  // ======================================
  describe('serializeRange', () => {
    it('should convert 0-based vscode Range to 1-based RangeInfo', () => {
      const range = new MockRange(0, 0, 5, 10) as any;
      const result: RangeInfo = serializeRange(range);
      expect(result.startLine).to.equal(1);
      expect(result.startCharacter).to.equal(1);
      expect(result.endLine).to.equal(6);
      expect(result.endCharacter).to.equal(11);
    });

    it('should handle single-character range', () => {
      const range = new MockRange(3, 7, 3, 8) as any;
      const result = serializeRange(range);
      expect(result.startLine).to.equal(4);
      expect(result.startCharacter).to.equal(8);
      expect(result.endLine).to.equal(4);
      expect(result.endCharacter).to.equal(9);
    });

    it('should handle range at origin', () => {
      const range = new MockRange(0, 0, 0, 0) as any;
      const result = serializeRange(range);
      expect(result.startLine).to.equal(1);
      expect(result.startCharacter).to.equal(1);
      expect(result.endLine).to.equal(1);
      expect(result.endCharacter).to.equal(1);
    });
  });

  // ======================================
  // serializeSymbolKind
  // ======================================
  describe('serializeSymbolKind', () => {
    it('should return "Function" for SymbolKind.Function (11)', () => {
      expect(serializeSymbolKind(11 as any)).to.equal('Function');
    });

    it('should return "Class" for SymbolKind.Class (4)', () => {
      expect(serializeSymbolKind(4 as any)).to.equal('Class');
    });

    it('should return string number for unknown kind', () => {
      expect(serializeSymbolKind(999 as any)).to.equal('999');
    });
  });

  // ======================================
  // serializeLocationInfo
  // ======================================
  describe('serializeLocationInfo', () => {
    it('should serialize a Location with relative path', () => {
      const uri = new MockUri('/workspace/src/foo.ts');
      const range = new MockRange(10, 5, 10, 20);
      const location = new MockLocation(uri, range);
      const getRelPath = (u: any) => 'src/foo.ts';
      const result = serializeLocationInfo(location as any, getRelPath);
      expect(result.path).to.equal('src/foo.ts');
      expect(result.range.startLine).to.equal(11);
      expect(result.range.startCharacter).to.equal(6);
    });

    it('should serialize a LocationLink', () => {
      const locationLink = {
        targetUri: new MockUri('/workspace/src/bar.ts'),
        targetRange: new MockRange(20, 0, 25, 0),
        originSelectionRange: new MockRange(0, 0, 0, 0)
      };
      const getRelPath = (u: any) => 'src/bar.ts';
      const result = serializeLocationInfo(locationLink as any, getRelPath);
      expect(result.path).to.equal('src/bar.ts');
      expect(result.range.startLine).to.equal(21);
    });
  });

  // ======================================
  // renderHoverContents
  // ======================================
  describe('renderHoverContents', () => {
    it('should handle a single string', () => {
      const result = renderHoverContents('hello' as any);
      expect(result).to.deep.equal(['hello']);
    });

    it('should handle array of strings', () => {
      const result = renderHoverContents(['hello', 'world'] as any);
      expect(result).to.deep.equal(['hello', 'world']);
    });

    it('should handle MarkdownString with value', () => {
      const result = renderHoverContents({ value: '**bold**' } as any);
      expect(result).to.deep.equal(['**bold**']);
    });

    it('should handle array of MarkdownStrings', () => {
      const result = renderHoverContents([
        { value: 'first' },
        { value: 'second' }
      ] as any);
      expect(result).to.deep.equal(['first', 'second']);
    });

    it('should handle mixed content (string + MarkdownString)', () => {
      const result = renderHoverContents([
        'plain',
        { value: 'rich' }
      ] as any);
      expect(result).to.deep.equal(['plain', 'rich']);
    });

    it('should handle empty array', () => {
      const result = renderHoverContents([] as any);
      expect(result).to.deep.equal([]);
    });
  });

  // ======================================
  // serializeDiagnosticSeverity
  // ======================================
  describe('serializeDiagnosticSeverity', () => {
    it('should return Error for severity 0', () => {
      expect(serializeDiagnosticSeverity(0 as any)).to.equal('Error');
    });
    it('should return Warning for severity 1', () => {
      expect(serializeDiagnosticSeverity(1 as any)).to.equal('Warning');
    });
    it('should return Information for severity 2', () => {
      expect(serializeDiagnosticSeverity(2 as any)).to.equal('Information');
    });
    it('should return Hint for severity 3', () => {
      expect(serializeDiagnosticSeverity(3 as any)).to.equal('Hint');
    });
    it('should return string number for unknown severity', () => {
      expect(serializeDiagnosticSeverity(99 as any)).to.equal('99');
    });
  });

  // ======================================
  // getPositionFromArgs
  // ======================================
  describe('getPositionFromArgs', () => {
    it('should parse line and character', () => {
      const result = getPositionFromArgs({ line: 5, character: 10 });
      expect(result.line).to.equal(5);
      expect(result.character).to.equal(10);
      expect(result.position).to.exist;
      expect(result.error).to.be.undefined;
    });

    it('should handle lineNumber alias', () => {
      const result = getPositionFromArgs({ lineNumber: 3, character: 1 });
      expect(result.line).to.equal(3);
    });

    it('should handle column alias', () => {
      const result = getPositionFromArgs({ line: 3, column: 7 });
      expect(result.character).to.equal(7);
    });

    it('should handle nested position object', () => {
      const result = getPositionFromArgs({ position: { line: 2, character: 4 } });
      expect(result.line).to.equal(2);
      expect(result.character).to.equal(4);
    });

    it('should return error when line is missing', () => {
      const result = getPositionFromArgs({ character: 5 });
      expect(result.error).to.be.a('string');
    });

    it('should return error when character is missing', () => {
      const result = getPositionFromArgs({ line: 5 });
      expect(result.error).to.be.a('string');
    });

    it('should clamp line to minimum 1', () => {
      const result = getPositionFromArgs({ line: -5, character: 1 });
      expect(result.line).to.equal(1);
    });

    it('should create Position with 0-based values', () => {
      const result = getPositionFromArgs({ line: 3, character: 5 });
      expect(result.position!.line).to.equal(2);   // 0-based
      expect(result.position!.character).to.equal(4); // 0-based
    });
  });

  // ======================================
  // collectDocumentSymbols
  // ======================================
  describe('collectDocumentSymbols', () => {
    function makeDocSymbol(name: string, kind: number, children: any[] = []): any {
      return {
        name,
        kind,
        detail: '',
        range: new MockRange(0, 0, 1, 0),
        selectionRange: new MockRange(0, 0, 0, name.length),
        children
      };
    }

    it('should collect flat symbols', () => {
      const symbols = [
        makeDocSymbol('foo', 11),
        makeDocSymbol('bar', 12)
      ];
      const result = collectDocumentSymbols(symbols, 5, 100);
      expect(result.symbols).to.have.length(2);
      expect(result.total).to.equal(2);
      expect(result.truncated).to.equal(false);
      expect(result.symbols[0].name).to.equal('foo');
    });

    it('should collect nested symbols up to maxDepth', () => {
      const child = makeDocSymbol('inner', 12);
      const parent = makeDocSymbol('outer', 4, [child]);
      const result = collectDocumentSymbols([parent], 1, 100);
      expect(result.symbols).to.have.length(1);
      expect(result.total).to.equal(2);
      expect((result.symbols[0].children as any[]).length).to.equal(1);
    });

    it('should not recurse past maxDepth', () => {
      const deep = makeDocSymbol('deep', 12);
      const mid = makeDocSymbol('mid', 11, [deep]);
      const top = makeDocSymbol('top', 4, [mid]);
      const result = collectDocumentSymbols([top], 1, 100);
      expect(result.total).to.equal(2); // top + mid, deep skipped
    });

    it('should truncate at maxResults', () => {
      const symbols = Array.from({ length: 10 }, (_, i) => makeDocSymbol(`sym${i}`, 11));
      const result = collectDocumentSymbols(symbols, 5, 3);
      expect(result.symbols).to.have.length(3);
      expect(result.truncated).to.equal(true);
    });

    it('should handle empty array', () => {
      const result = collectDocumentSymbols([], 5, 100);
      expect(result.symbols).to.have.length(0);
      expect(result.total).to.equal(0);
    });
  });

  // ======================================
  // collectSymbolInformation
  // ======================================
  describe('collectSymbolInformation', () => {
    function makeSymInfo(name: string, kind: number, container: string = ''): any {
      return {
        name,
        kind,
        containerName: container,
        location: new MockLocation(new MockUri('/test.ts'), new MockRange(0, 0, 1, 0))
      };
    }

    it('should collect SymbolInformation items', () => {
      const symbols = [
        makeSymInfo('foo', 11, 'module'),
        makeSymInfo('bar', 12)
      ];
      const result = collectSymbolInformation(symbols, 100);
      expect(result.symbols).to.have.length(2);
      expect(result.total).to.equal(2);
      expect(result.symbols[0].name).to.equal('foo');
      expect(result.symbols[0].containerName).to.equal('module');
    });

    it('should truncate at maxResults', () => {
      const symbols = Array.from({ length: 10 }, (_, i) => makeSymInfo(`s${i}`, 11));
      const result = collectSymbolInformation(symbols, 3);
      expect(result.symbols).to.have.length(3);
      expect(result.truncated).to.equal(true);
    });

    it('should handle empty array', () => {
      const result = collectSymbolInformation([], 100);
      expect(result.symbols).to.have.length(0);
      expect(result.total).to.equal(0);
      expect(result.truncated).to.equal(false);
    });
  });
});
