// Utility functions

export function normalizeTaskWeight(w: number | undefined): number {
  // Normalize existing 0.1-1.0 scale to 1-10, and clamp any value to [1,10]
  if (typeof w !== 'number' || isNaN(w)) return 5;
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
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
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
