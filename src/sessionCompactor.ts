/**
 * Session Compactor — Intelligent conversation compression.
 *
 * Inspired by OpenClaw's `/compact` command.
 * Compresses older messages into a summary while preserving key facts,
 * keeping recent messages in full detail.
 */

import type { ChatMessage } from './types';

/** How many recent message pairs (user+assistant) to keep in full. */
const KEEP_RECENT_PAIRS = 3;
/** Max total messages before compaction is recommended. */
const COMPACTION_THRESHOLD = 16;

export interface CompactionResult {
  compacted: boolean;
  messages: ChatMessage[];
  saved: number;
  summaryContent: string;
}

/**
 * Check whether a conversation should be compacted.
 */
export function shouldCompact(messages: ChatMessage[]): boolean {
  const nonSystem = messages.filter(m => m.role !== 'system');
  return nonSystem.length > COMPACTION_THRESHOLD;
}

/**
 * Compact a conversation by summarizing old messages into a system-level summary
 * and keeping the most recent messages in full.
 *
 * Does NOT call an LLM — uses a fast extractive approach that preserves
 * file names, decisions, technical details, and errors.
 */
export function compactMessages(messages: ChatMessage[]): CompactionResult {
  const nonSystem = messages.filter(m => m.role !== 'system');
  const systemMessages = messages.filter(m => m.role === 'system');

  if (nonSystem.length <= COMPACTION_THRESHOLD) {
    return { compacted: false, messages, saved: 0, summaryContent: '' };
  }

  // Split: old messages to summarize, recent messages to keep
  const keepCount = KEEP_RECENT_PAIRS * 2; // pairs → individual messages
  const oldMessages = nonSystem.slice(0, -keepCount);
  const recentMessages = nonSystem.slice(-keepCount);

  // Extract facts from old messages
  const facts = extractFacts(oldMessages);
  const summaryContent = buildSummaryBlock(facts, oldMessages.length);

  const summaryMessage: ChatMessage = {
    role: 'system',
    content: summaryContent,
    timestamp: Date.now()
  };

  // Rebuild: system messages + summary + recent
  const compacted = [...systemMessages, summaryMessage, ...recentMessages];

  return {
    compacted: true,
    messages: compacted,
    saved: oldMessages.length,
    summaryContent
  };
}

interface ExtractedFacts {
  files: string[];
  decisions: string[];
  errors: string[];
  techDetails: string[];
  topicSummary: string;
}

function extractFacts(messages: ChatMessage[]): ExtractedFacts {
  const files = new Set<string>();
  const decisions: string[] = [];
  const errors: string[] = [];
  const techDetails: string[] = [];
  const topics: string[] = [];

  for (const msg of messages) {
    const content = msg.content;

    // Extract file paths
    const fileMatches = content.match(/(?:[\w./\\-]+\.(?:ts|js|py|json|md|yaml|yml|css|html|tsx|jsx|go|rs|java|cs|sql|sh|toml))/g);
    if (fileMatches) {
      for (const f of fileMatches) files.add(f);
    }

    // Extract decisions (keywords)
    if (/rozhodl|rozhodn|zvolil|vyber|použi|implementuj|přidej|odstraň|oprav/i.test(content)) {
      const sentence = extractFirstSentence(content);
      if (sentence.length > 10 && sentence.length < 200) {
        decisions.push(sentence);
      }
    }

    // Extract errors
    if (/error|chyba|fail|FAIL|selhalo|nefunguje|bug/i.test(content)) {
      const sentence = extractFirstSentence(content);
      if (sentence.length > 10 && sentence.length < 200) {
        errors.push(sentence);
      }
    }

    // Extract technical details
    if (/npm|yarn|pnpm|pip|config|verz[ei]|model|timeout|port|endpoint/i.test(content)) {
      const sentence = extractFirstSentence(content);
      if (sentence.length > 10 && sentence.length < 200) {
        techDetails.push(sentence);
      }
    }

    // First user message as topic
    if (msg.role === 'user' && topics.length < 3) {
      topics.push(content.slice(0, 100));
    }
  }

  return {
    files: [...files].slice(0, 20),
    decisions: dedupe(decisions).slice(0, 8),
    errors: dedupe(errors).slice(0, 5),
    techDetails: dedupe(techDetails).slice(0, 5),
    topicSummary: topics.join(' → ')
  };
}

function buildSummaryBlock(facts: ExtractedFacts, messageCount: number): string {
  const lines = [
    `[KONTEXT KOMPRIMOVÁN — ${messageCount} starších zpráv shrnuto]`,
    ''
  ];

  if (facts.topicSummary) {
    lines.push(`TÉMATA: ${facts.topicSummary}`);
    lines.push('');
  }

  if (facts.files.length > 0) {
    lines.push(`SOUBORY: ${facts.files.join(', ')}`);
    lines.push('');
  }

  if (facts.decisions.length > 0) {
    lines.push('ROZHODNUTÍ:');
    for (const d of facts.decisions) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  if (facts.errors.length > 0) {
    lines.push('CHYBY/PROBLÉMY:');
    for (const e of facts.errors) {
      lines.push(`- ${e}`);
    }
    lines.push('');
  }

  if (facts.techDetails.length > 0) {
    lines.push('TECHNICKÉ DETAILY:');
    for (const t of facts.techDetails) {
      lines.push(`- ${t}`);
    }
  }

  return lines.join('\n');
}

function extractFirstSentence(text: string): string {
  const clean = text.replace(/```[\s\S]*?```/g, '').replace(/\n+/g, ' ').trim();
  const match = clean.match(/^(.{10,200}?[.!?])\s/);
  return match ? match[1] : clean.slice(0, 150);
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter(s => {
    const key = s.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
