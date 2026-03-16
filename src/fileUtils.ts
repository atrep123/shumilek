import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

// ============================================================
// Binary extensions
// ============================================================

export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tiff',
  '.pdf', '.zip', '.gz', '.tar', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.class', '.jar', '.wasm',
  '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.wav', '.flac'
]);

// ============================================================
// String helpers
// ============================================================

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function getFirstStringArg(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

// ============================================================
// File name and extension utilities
// ============================================================

export function formatTimestampForName(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function sanitizeFileName(input: string): string {
  const ascii = input.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
  const cleaned = ascii.replace(/[/\\?%*:|"<>]/g, '-').trim();
  const collapsed = cleaned.replace(/\s+/g, '-').replace(/-+/g, '-');
  const trimmed = collapsed.replace(/^\.+/, '').replace(/\.+$/, '');
  return trimmed.slice(0, 120);
}

export function normalizeExtension(ext: string | undefined): string {
  if (!ext) return '';
  const cleaned = ext.trim().toLowerCase();
  if (!cleaned) return '';
  const withDot = cleaned.startsWith('.') ? cleaned : `.${cleaned}`;
  return withDot.replace(/[^a-z0-9.]/g, '');
}

export function extractExtensionFromName(name: string | undefined): string {
  if (!name) return '';
  return normalizeExtension(path.extname(name));
}

export function inferExtensionFromTitle(title: string | undefined): string {
  if (!title) return '';
  const t = title.toLowerCase();
  if (t.includes('arduino') || t.includes('neopixel') || t.includes('.ino')) return '.ino';
  if (t.includes('markdown') || t.includes('.md')) return '.md';
  if (t.includes('typescript') || t.includes('.ts')) return '.ts';
  if (t.includes('javascript') || t.includes('.js')) return '.js';
  if (t.includes('json')) return '.json';
  if (t.includes('yaml') || t.includes('.yml') || t.includes('.yaml')) return '.yaml';
  if (t.includes('html')) return '.html';
  if (t.includes('css')) return '.css';
  if (t.includes('cpp') || t.includes('c++')) return '.cpp';
  if (t.includes('c ')) return '.c';
  if (t.includes('python') || t.includes('.py')) return '.py';
  return '';
}

export function inferExtensionFromContent(content: string | undefined): string {
  if (!content) return '';
  const sample = content.slice(0, 2000).trim();
  if (!sample) return '';
  const lower = sample.toLowerCase();
  if (lower.startsWith('{') || lower.startsWith('[')) return '.json';
  const firstLine = sample.split(/\r\n|\n/, 1)[0]?.trim() ?? '';
  if (firstLine.startsWith('#')) return '.md';
  if (lower.includes('<!doctype html') || lower.includes('<html')) return '.html';
  if (lower.includes('<?xml')) return '.xml';
  if (lower.includes('void setup(') || lower.includes('void loop(')) return '.ino';
  if (lower.includes('adafruit_neopixel') || lower.includes('neopixel')) return '.ino';
  return '';
}

export function inferNameFromContent(content: string | undefined): string {
  if (!content) return '';
  const lines = content.split(/\r\n|\n/).slice(0, 30);
  let inFrontMatter = false;
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) continue;
    if (i === 0 && line === '---') {
      inFrontMatter = true;
      continue;
    }
    if (inFrontMatter) {
      if (line === '---') {
        inFrontMatter = false;
        continue;
      }
      const match = line.match(/^title:\s*(.+)$/i);
      if (match) {
        const cleaned = match[1].replace(/^["']|["']$/g, '');
        return sanitizeFileName(cleaned);
      }
      continue;
    }
    if (line.startsWith('#')) {
      return sanitizeFileName(line.replace(/^#+\s*/, ''));
    }
    if (line.startsWith('//')) {
      return sanitizeFileName(line.replace(/^\/\/+\s*/, ''));
    }
    if (line.startsWith('/*')) {
      return sanitizeFileName(line.replace(/^\/\*\s*/, '').replace(/\*\/.*/, ''));
    }
    const match = line.match(/^(?:export\s+)?(?:class|function|interface|type)\s+([A-Za-z0-9_]+)/);
    if (match) {
      return sanitizeFileName(match[1]);
    }
  }
  return '';
}

export function buildAutoFileName(options: {
  title?: string;
  suggestedName?: string;
  extension?: string;
  content?: string;
}): string {
  const title = options.title;
  const suggestedNameRaw = options.suggestedName;
  const extensionRaw = options.extension;
  const content = options.content;
  const extFromSuggested = extractExtensionFromName(suggestedNameRaw);
  const extFromTitle = inferExtensionFromTitle(title);
  const extFromContent = inferExtensionFromContent(content);
  let extension = normalizeExtension(extensionRaw || extFromSuggested || extFromTitle || extFromContent);
  if (!extension) extension = '.txt';

  let baseName = '';
  if (suggestedNameRaw) {
    baseName = sanitizeFileName(path.parse(suggestedNameRaw).name);
  } else if (title) {
    baseName = sanitizeFileName(title);
  } else if (content) {
    baseName = inferNameFromContent(content);
  }
  if (!baseName) baseName = 'shumilek-output';

  let fileName = baseName;
  if (baseName === 'shumilek-output') {
    fileName = `${baseName}-${formatTimestampForName()}`;
  }
  return `${fileName}${extension}`;
}

// ============================================================
// Route text normalization
// ============================================================

export function normalizeRouteText(input: string): string {
  return input.normalize('NFKD').replace(/[^\x00-\x7F]/g, '').toLowerCase();
}

export function tokenizeRouteText(input: string): string[] {
  const cleaned = normalizeRouteText(input).replace(/[^a-z0-9_.-]+/g, ' ');
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.filter(part => part.length >= 2);
}

// ============================================================
// Content hashing and binary detection
// ============================================================

export function computeContentHash(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function isBinaryExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

export function isProbablyBinary(buffer: Uint8Array): boolean {
  let suspicious = 0;
  const total = buffer.length;
  if (total === 0) return false;
  for (let i = 0; i < total; i++) {
    const byte = buffer[i];
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) {
      suspicious++;
    }
  }
  return (suspicious / total) > 0.3;
}

export async function readFileForTool(
  uri: vscode.Uri,
  maxBytes: number
): Promise<{ text?: string; size?: number; hash?: string; error?: string; binary?: boolean }> {
  if (isBinaryExtension(uri.fsPath)) {
    return { error: 'soubor vypada jako binarni (extenze)', binary: true };
  }

  const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === uri.fsPath);
  if (openDoc) {
    const text = openDoc.getText();
    const size = Buffer.byteLength(text, 'utf8');
    if (size > maxBytes) {
      return { error: `soubor je moc velky (${size} bytes), limit ${maxBytes}`, size };
    }
    return { text, size, hash: computeContentHash(text) };
  }

  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.size > maxBytes) {
    return { error: `soubor je moc velky (${stat.size} bytes), limit ${maxBytes}`, size: stat.size };
  }

  const buffer = await vscode.workspace.fs.readFile(uri);
  if (isProbablyBinary(buffer)) {
    return { error: 'soubor vypada jako binarni (obsah)', binary: true, size: buffer.length };
  }
  const text = new TextDecoder().decode(buffer);
  return { text, size: buffer.length, hash: computeContentHash(text) };
}
