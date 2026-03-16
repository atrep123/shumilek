import * as vscode from 'vscode';
import { clampNumber } from './configResolver';

// ============================================================
// Types
// ============================================================

export interface RangeInfo {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

// ============================================================
// Range & position serialization
// ============================================================

export function serializeRange(range: vscode.Range): RangeInfo {
  return {
    startLine: range.start.line + 1,
    startCharacter: range.start.character + 1,
    endLine: range.end.line + 1,
    endCharacter: range.end.character + 1
  };
}

export function serializeSymbolKind(kind: vscode.SymbolKind): string {
  const label = (vscode.SymbolKind as Record<number, string>)[kind];
  return label ?? String(kind);
}

export function getPositionFromArgs(
  args: Record<string, unknown>,
  doc?: vscode.TextDocument
): { position?: vscode.Position; line?: number; character?: number; error?: string } {
  const rawLine = typeof args.line === 'number'
    ? args.line
    : (typeof args.lineNumber === 'number'
      ? args.lineNumber
      : (args.position && typeof args.position === 'object' && typeof (args.position as any).line === 'number'
        ? (args.position as any).line
        : undefined));
  const rawChar = typeof args.character === 'number'
    ? args.character
    : (typeof args.column === 'number'
      ? args.column
      : (args.position && typeof args.position === 'object' && typeof (args.position as any).character === 'number'
        ? (args.position as any).character
        : undefined));
  if (typeof rawLine !== 'number' || typeof rawChar !== 'number') {
    return { error: 'line a character jsou povinne' };
  }
  const line = Math.max(1, Math.floor(rawLine));
  const character = Math.max(1, Math.floor(rawChar));
  if (doc) {
    const clampedLine = clampNumber(line, 1, 1, doc.lineCount || 1);
    const lineText = doc.lineAt(clampedLine - 1).text;
    const clampedChar = clampNumber(character, 1, 1, Math.max(1, lineText.length + 1));
    return {
      position: new vscode.Position(clampedLine - 1, clampedChar - 1),
      line: clampedLine,
      character: clampedChar
    };
  }
  return {
    position: new vscode.Position(line - 1, character - 1),
    line,
    character
  };
}

// ============================================================
// Location & hover serialization
// ============================================================

export function serializeLocationInfo(
  location: vscode.Location | vscode.LocationLink,
  getRelativePath: (uri: vscode.Uri) => string
): { path: string; range: RangeInfo } {
  const uri = 'targetUri' in location ? location.targetUri : location.uri;
  const range = 'targetRange' in location ? location.targetRange : location.range;
  return {
    path: getRelativePath(uri),
    range: serializeRange(range)
  };
}

export function renderHoverContents(
  contents:
  | vscode.MarkedString
  | vscode.MarkedString[]
  | vscode.MarkdownString
  | vscode.MarkdownString[]
  | Array<vscode.MarkedString | vscode.MarkdownString>
): string[] {
  const list = Array.isArray(contents) ? contents : [contents];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      out.push(item);
    } else if (item && typeof item === 'object') {
      const anyItem = item as { value?: string; language?: string };
      if (typeof anyItem.value === 'string') {
        out.push(anyItem.value);
      } else if ('value' in item) {
        out.push(String((item as any).value));
      } else {
        out.push(String(item));
      }
    }
  }
  return out;
}

// ============================================================
// Diagnostic severity
// ============================================================

export function serializeDiagnosticSeverity(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'Error';
    case vscode.DiagnosticSeverity.Warning:
      return 'Warning';
    case vscode.DiagnosticSeverity.Information:
      return 'Information';
    case vscode.DiagnosticSeverity.Hint:
      return 'Hint';
    default:
      return String(severity);
  }
}

// ============================================================
// Symbol collection
// ============================================================

export function collectDocumentSymbols(
  symbols: vscode.DocumentSymbol[],
  maxDepth: number,
  maxResults: number
): { symbols: Array<Record<string, unknown>>; total: number; truncated: boolean } {
  let count = 0;
  let truncated = false;
  const walk = (symbol: vscode.DocumentSymbol, depth: number): Record<string, unknown> | null => {
    if (count >= maxResults) {
      truncated = true;
      return null;
    }
    count++;
    const node: Record<string, unknown> = {
      name: symbol.name,
      kind: serializeSymbolKind(symbol.kind),
      detail: symbol.detail,
      range: serializeRange(symbol.range),
      selectionRange: serializeRange(symbol.selectionRange)
    };
    if (symbol.children && symbol.children.length > 0 && depth < maxDepth) {
      const children: Array<Record<string, unknown>> = [];
      for (const child of symbol.children) {
        const childNode = walk(child, depth + 1);
        if (childNode) children.push(childNode);
      }
      node.children = children;
    }
    return node;
  };
  const result: Array<Record<string, unknown>> = [];
  for (const symbol of symbols) {
    const node = walk(symbol, 0);
    if (node) result.push(node);
  }
  return { symbols: result, total: count, truncated };
}

export function collectSymbolInformation(
  symbols: vscode.SymbolInformation[],
  maxResults: number
): { symbols: Array<Record<string, unknown>>; total: number; truncated: boolean } {
  const result: Array<Record<string, unknown>> = [];
  let count = 0;
  for (const symbol of symbols) {
    if (count >= maxResults) break;
    count++;
    result.push({
      name: symbol.name,
      kind: serializeSymbolKind(symbol.kind),
      containerName: symbol.containerName,
      range: serializeRange(symbol.location.range)
    });
  }
  return { symbols: result, total: count, truncated: count >= maxResults };
}

export async function resolveSymbolPosition(
  uri: vscode.Uri,
  symbolName: string
): Promise<vscode.Position | undefined> {
  const docSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | vscode.SymbolInformation[]>(
    'vscode.executeDocumentSymbolProvider',
    uri
  );
  if (!docSymbols || docSymbols.length === 0) return undefined;
  const lower = symbolName.toLowerCase();
  if ('location' in (docSymbols[0] as any)) {
    const infoSymbols = docSymbols as vscode.SymbolInformation[];
    const match = infoSymbols.find(sym => sym.name.toLowerCase() === lower) ?? infoSymbols[0];
    return match.location.range.start;
  }
  const walk = (symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol | undefined => {
    let first: vscode.DocumentSymbol | undefined;
    for (const symbol of symbols) {
      if (!first) first = symbol;
      if (symbol.name.toLowerCase() === lower) return symbol;
      if (symbol.children && symbol.children.length > 0) {
        const found = walk(symbol.children);
        if (found) return found;
      }
    }
    return first;
  };
  const match = walk(docSymbols as vscode.DocumentSymbol[]);
  return match?.selectionRange.start;
}
