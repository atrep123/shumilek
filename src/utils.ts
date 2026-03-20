// Utility functions

import { URL } from 'url';
import * as crypto from 'crypto';
import * as dns from 'dns';

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fd/i,
  /^fe80:/i,
];

/**
 * Validate a URL for safe external fetching.
 * Blocks private/reserved IPs, non-http(s) schemes, cloud metadata endpoints,
 * and DNS rebinding (hostname resolving to private IP).
 */
export async function isSafeUrl(raw: string): Promise<{ safe: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { safe: false, reason: 'Neplatná URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `Nepovolený protokol: ${parsed.protocol}` };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '[::1]') {
    return { safe: false, reason: 'Přístup na localhost je zakázán' };
  }
  for (const re of PRIVATE_IP_RANGES) {
    if (re.test(hostname)) {
      return { safe: false, reason: 'Přístup na privátní IP je zakázán' };
    }
  }
  // Block cloud metadata endpoints
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    return { safe: false, reason: 'Přístup ke cloud metadata je zakázán' };
  }
  // DNS rebinding check: resolve hostname and validate resolved IP
  try {
    const address = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('DNS lookup timeout')); }
      }, 5000);
      dns.promises.lookup(hostname).then(
        ({ address }) => { clearTimeout(timer); if (!settled) { settled = true; resolve(address); } },
        (err) => { clearTimeout(timer); if (!settled) { settled = true; reject(err); } }
      );
    });
    // Strip IPv4-mapped IPv6 prefix for consistent checking
    const normalizedAddr = address.replace(/^::ffff:/i, '');
    for (const re of PRIVATE_IP_RANGES) {
      if (re.test(normalizedAddr)) {
        return { safe: false, reason: 'DNS resolves to private IP — possible rebinding attack' };
      }
    }
    if (normalizedAddr === '169.254.169.254') {
      return { safe: false, reason: 'DNS resolves to cloud metadata endpoint' };
    }
  } catch {
    return { safe: false, reason: 'DNS lookup failed — cannot verify URL safety' };
  }
  return { safe: true };
}

export function normalizeTaskWeight(w: number | undefined): number {
  // Normalize existing 0.1-1.0 scale to 1-10, and clamp any value to [1,10]
  if (typeof w !== 'number' || Number.isNaN(w)) return 5;
  if (w <= 1) {
    // assume legacy 0.1-1.0 scale
    return Math.max(1, Math.min(10, Math.round(w * 10)));
  }
  return Math.max(1, Math.min(10, Math.round(w)));
}

export function isChatMessage(value: unknown): value is { role: string; content: string; timestamp?: number } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const roleOk = v.role === 'system' || v.role === 'user' || v.role === 'assistant';
  const contentOk = typeof v.content === 'string';
  const timestampOk = v.timestamp === undefined || typeof v.timestamp === 'number';
  return roleOk && contentOk && timestampOk;
}

export function getNonce(): string {
  return crypto.randomBytes(16).toString('base64url');
}

export function pickBrainModel(prompt: string, candidates: string[], fallback: string): string {
  const normalized = prompt.toLowerCase();
  const prefersCode = /refaktor|bug|chyba|code|k[oó]d|test|typ|lint/.test(normalized);
  if (candidates.length === 0) return fallback;
  if (candidates.length === 1) return candidates[0];

  // Heuristic: prefer coder model for code-heavy tasks, otherwise first in list.
  if (prefersCode) {
    const match = candidates.find(m => m.toLowerCase().includes('coder')) ?? candidates[0];
    return match;
  }
  return candidates[0];
}

export function normalizeScore(value: unknown): number | undefined {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Translate raw API/network error messages into user-friendly Czech messages
 * with actionable guidance. Returns the original message if no pattern matches.
 */
export function humanizeApiError(raw: string): string {
  // Truncate to prevent ReDoS on unbounded error strings
  const safeRaw = raw.length > 1000 ? raw.slice(0, 1000) : raw;
  const lower = safeRaw.toLowerCase();

  if (lower.includes('econnrefused') || lower.includes('connect econnrefused')) {
    return 'Nelze se připojit k Ollama serveru. Zkontrolujte, že Ollama běží (spusťte `ollama serve`).';
  }
  if (lower.includes('enotfound') || lower.includes('getaddrinfo')) {
    return 'Server nenalezen — zkontrolujte URL v nastavení (shumilek.baseUrl).';
  }
  if (lower.includes('etimedout') || lower.includes('socket hang up') || lower.includes('network timeout')) {
    return 'Spojení s modelem vypršelo. Model může být přetížený nebo pomalý — zkuste zmenšit kontext nebo použít menší model.';
  }
  if (lower.includes('econnreset')) {
    return 'Spojení bylo neočekávaně přerušeno. Ollama mohla spadnout — restartujte ji příkazem `ollama serve`.';
  }
  if (lower.includes('model') && lower.includes('not found')) {
    const modelMatch = safeRaw.match(/model\s+['"]?([^\s'"]+)['"]?/i);
    const modelName = modelMatch?.[1] ?? '';
    return `Model ${modelName ? `"${modelName}" ` : ''}nenalezen. Stáhněte ho příkazem \`ollama pull ${modelName || '<model>'}\`.`;
  }
  if (/http\s+5\d{2}/.test(lower)) {
    return 'Ollama server vrátil interní chybu (5xx). Restartujte Ollama a zkuste to znovu.';
  }
  if (lower.includes('http 404')) {
    return 'Endpoint nenalezen (404). Zkontrolujte verzi Ollama a baseUrl v nastavení.';
  }
  if (lower.includes('aborted') || lower.includes('abort')) {
    return raw;
  }

  return raw;
}

/**
 * Detect transient network/server errors that are worth retrying.
 * Returns true for ECONNRESET, ETIMEDOUT, socket hang up, HTTP 5xx, etc.
 */
export function isTransientError(error: Error | string): boolean {
  const msg = (typeof error === 'string' ? error : error.message ?? '').toLowerCase();
  if (msg.includes('econnreset')) return true;
  if (msg.includes('etimedout')) return true;
  if (msg.includes('socket hang up')) return true;
  if (msg.includes('network timeout')) return true;
  if (/http\s+5\d{2}/.test(msg)) return true;
  if (msg.includes('epipe')) return true;
  if (msg.includes('econnaborted')) return true;
  return false;
}
