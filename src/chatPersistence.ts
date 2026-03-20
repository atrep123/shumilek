// ============================================================
// CHAT PERSISTENCE — pure chat message helpers
// ============================================================

import { ChatMessage, QualityCheckResult } from './types';
import { isChatMessage } from './utils';

export function getLastAssistantMessage(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'assistant') return m;
  }
  return undefined;
}

export function extractPreferredFencedCodeBlock(text: string): { code: string; lang?: string } | null {
  const fenceRegex = /```([a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)```/g;
  const matches: Array<{ lang?: string; code: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(text)) !== null) {
    const lang = typeof match[1] === 'string' ? match[1].trim().toLowerCase() : undefined;
    const code = typeof match[2] === 'string' ? match[2] : '';
    if (code.trim().length > 0) matches.push({ lang, code });
  }
  if (matches.length === 0) return null;

  const preferred = ['ino', 'arduino', 'cpp', 'c', 'c++'];
  const best = matches.find(m => m.lang && preferred.includes(m.lang)) ?? matches[0];
  return { code: best.code.replace(/\r\n/g, '\n').trimEnd(), lang: best.lang };
}

export function sanitizeChatMessages(raw: unknown): ChatMessage[] {
  if (!raw || typeof raw !== 'object') return [];
  const maybeState = raw as any;
  const arr = Array.isArray(maybeState.messages) ? maybeState.messages : [];
  const MAX_CONTENT_LEN = 100_000;
  const sanitized = arr.filter(isChatMessage).map((m: ChatMessage) => ({
    role: m.role,
    content: m.content.length > MAX_CONTENT_LEN ? m.content.slice(0, MAX_CONTENT_LEN) : m.content,
    timestamp: typeof m.timestamp === 'number' ? m.timestamp : undefined
  }));

  // Prevent UI/perf issues on very large histories.
  if (sanitized.length > 200) {
    console.warn(`[ChatState] History truncated from ${sanitized.length} to 200 messages`);
  }
  return sanitized.slice(-200);
}

export function formatQualityReport(results: QualityCheckResult[]): string {
  if (results.length === 0) return '';
  const lines = results.map(result => {
    const status = result.unavailable ? 'SKIPPED' : (result.ok ? 'PASS' : 'FAIL');
    const scoreText = typeof result.score === 'number'
      ? ` (skore ${result.score}${typeof result.threshold === 'number' ? ` / prah ${result.threshold}` : ''}${typeof result.rawScore === 'number' && result.rawScore !== result.score ? `, raw ${result.rawScore}` : ''})`
      : '';
    const details = result.details ? ` - ${result.details}` : '';
    return `- ${result.name}: ${status}${scoreText}${details}`;
  });
  return lines.join('\n');
}

export function buildStructuredOutput(
  response: string,
  summary: string | null,
  checks: QualityCheckResult[],
  includeResponse: boolean = true
): string {
  const report = formatQualityReport(checks);
  let out = includeResponse ? `## Vysledek\n\n${response.trim()}` : response.trim();
  if (report) {
    out += `\n\n## Kontroly kvality\n${report}`;
  }
  if (summary && summary.trim()) {
    out += `\n\n## Strucne shrnuti\n${summary.trim()}`;
  }
  return out;
}

export function normalizeExternalScore(
  score: number | undefined,
  threshold?: number
): { score?: number; rawScore?: number } {
  if (typeof score !== 'number' || Number.isNaN(score)) return { score: undefined };
  const rawScore = score;
  if (score > 1 && score <= 100 && (typeof threshold !== 'number' || threshold <= 1)) {
    return { score: score / 100, rawScore };
  }
  return { score, rawScore };
}
