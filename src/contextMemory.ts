/**
 * Context Memory — Smart conversation compression with session facts extraction.
 *
 * Prevents context overflow in long conversations by:
 * 1. Extracting key facts (files, decisions, errors) from older messages
 * 2. Summarizing old messages into a compact block
 * 3. Keeping recent messages in full detail
 */

import type { ChatMessage } from './types';

// ── Configuration ──────────────────────────────────────────────────
/** How many recent message pairs to keep in full (user+assistant = 1 pair). */
const RECENT_PAIRS_FULL = 4;
/** Max chars per summarized old message. */
const OLD_MESSAGE_SUMMARY_CHARS = 150;
/** Approximate chars-per-token ratio for budget estimation. */
const CHARS_PER_TOKEN = 4;
/** If estimated conversation tokens exceed this fraction of context window, compress. */
const COMPRESS_THRESHOLD = 0.65;

// ── Types ──────────────────────────────────────────────────────────
export interface SessionFacts {
  /** Files that were read, written, or discussed. */
  files: string[];
  /** Key decisions or conclusions reached. */
  decisions: string[];
  /** Errors encountered and how they were resolved. */
  errors: string[];
  /** Important technical details (dependencies, configs, patterns). */
  technicalDetails: string[];
}

export interface CompressedHistory {
  /** System message with session facts + old message summaries. */
  contextBlock: string;
  /** Recent messages kept in full. */
  recentMessages: ChatMessage[];
  /** Whether compression was applied. */
  wasCompressed: boolean;
  /** Stats for logging. */
  stats: {
    originalCount: number;
    summarizedCount: number;
    recentCount: number;
    estimatedTokensSaved: number;
  };
}

// ── Facts Extraction ───────────────────────────────────────────────

/** Regex patterns for extracting facts from messages. */
const FILE_PATTERN = /(?:(?:src|test|scripts|projects|docs)\/[\w./-]+|[\w-]+\.(?:ts|js|tsx|jsx|py|json|md|yml|yaml|css|html))\b/g;
const ERROR_PATTERN = /(?:error|chyba|fail|selhalo|bug|broken|nefunguje)[:\s]+(.{10,80})/gi;
const DECISION_PATTERN = /(?:rozhodl|decided|implemented|zvolil|pouzijeme|will use|switched to|changed to|vyber(?:al|eme))[:\s]+(.{10,100})/gi;
const TECH_PATTERN = /(?:npm|node|typescript|python|ollama|model|version|dependency|config|setting)[:\s]+(.{10,80})/gi;

/**
 * Extract session facts from a set of messages.
 */
export function extractSessionFacts(messages: ChatMessage[]): SessionFacts {
  const files = new Set<string>();
  const decisions: string[] = [];
  const errors: string[] = [];
  const technicalDetails: string[] = [];

  for (const msg of messages) {
    const text = msg.content;

    // Extract file paths
    const fileMatches = text.match(FILE_PATTERN);
    if (fileMatches) {
      for (const f of fileMatches) {
        files.add(f);
      }
    }

    // Extract errors
    for (const match of text.matchAll(ERROR_PATTERN)) {
      const err = match[1]?.trim();
      if (err && err.length > 10 && errors.length < 10) {
        errors.push(err);
      }
    }

    // Extract decisions
    for (const match of text.matchAll(DECISION_PATTERN)) {
      const dec = match[1]?.trim();
      if (dec && dec.length > 10 && decisions.length < 8) {
        decisions.push(dec);
      }
    }

    // Extract technical details
    for (const match of text.matchAll(TECH_PATTERN)) {
      const tech = match[1]?.trim();
      if (tech && tech.length > 10 && technicalDetails.length < 8) {
        technicalDetails.push(tech);
      }
    }
  }

  return {
    files: [...files].slice(0, 20),
    decisions: deduplicate(decisions),
    errors: deduplicate(errors),
    technicalDetails: deduplicate(technicalDetails)
  };
}

// ── Message Summarization ──────────────────────────────────────────

/**
 * Create a compact summary of a single message.
 */
function summarizeMessage(msg: ChatMessage, maxChars: number): string {
  const text = msg.content
    .replace(/```[\s\S]*?```/g, '[code block]')    // Collapse code blocks
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '[tool call]')
    .replace(/<tool_result>[\s\S]*?<\/tool_result>/g, '[tool result]')
    .replace(/\n{2,}/g, '\n')                       // Collapse blank lines
    .trim();

  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + '...';
}

/**
 * Build the session context block from facts and summarized old messages.
 */
function buildContextBlock(facts: SessionFacts, oldMessages: ChatMessage[]): string {
  const sections: string[] = ['[SESSION CONTEXT]'];

  if (facts.files.length > 0) {
    sections.push(`Files involved: ${facts.files.join(', ')}`);
  }
  if (facts.decisions.length > 0) {
    sections.push(`Key decisions: ${facts.decisions.join('; ')}`);
  }
  if (facts.errors.length > 0) {
    sections.push(`Resolved errors: ${facts.errors.join('; ')}`);
  }
  if (facts.technicalDetails.length > 0) {
    sections.push(`Technical context: ${facts.technicalDetails.join('; ')}`);
  }

  if (oldMessages.length > 0) {
    sections.push('');
    sections.push('[EARLIER CONVERSATION SUMMARY]');
    for (const msg of oldMessages) {
      const prefix = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
      const summary = summarizeMessage(msg, OLD_MESSAGE_SUMMARY_CHARS);
      if (summary && summary !== '[tool call]' && summary !== '[tool result]') {
        sections.push(`${prefix}: ${summary}`);
      }
    }
  }

  sections.push('[END SESSION CONTEXT]');
  return sections.join('\n');
}

// ── Main Compression Logic ─────────────────────────────────────────

/**
 * Estimate token count for a set of messages (rough: chars / 4).
 */
export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Compress conversation history if it exceeds the context budget.
 *
 * @param messages    Full conversation history
 * @param contextTokens  The model's context window size (num_ctx)
 * @param systemPromptChars  Estimated chars used by system prompt + workspace context
 * @returns Compressed history with context block + recent messages
 */
export function compressConversation(
  messages: ChatMessage[],
  contextTokens: number,
  systemPromptChars: number = 2000
): CompressedHistory {
  // Filter out system messages (they're injected separately)
  const conversationMessages = messages.filter(m => m.role !== 'system');

  const totalEstimatedTokens = estimateTokens(conversationMessages) + Math.ceil(systemPromptChars / CHARS_PER_TOKEN);
  const tokenBudget = contextTokens * COMPRESS_THRESHOLD;

  // No compression needed if within budget
  if (totalEstimatedTokens <= tokenBudget || conversationMessages.length <= RECENT_PAIRS_FULL * 2) {
    return {
      contextBlock: '',
      recentMessages: messages,
      wasCompressed: false,
      stats: {
        originalCount: messages.length,
        summarizedCount: 0,
        recentCount: messages.length,
        estimatedTokensSaved: 0
      }
    };
  }

  // Split into old and recent
  const recentCount = Math.min(RECENT_PAIRS_FULL * 2, conversationMessages.length);
  const splitIndex = conversationMessages.length - recentCount;
  const oldMessages = conversationMessages.slice(0, splitIndex);
  const recentMessages = conversationMessages.slice(splitIndex);

  // Extract facts from old messages
  const facts = extractSessionFacts(oldMessages);

  // Build context summary block
  const contextBlock = buildContextBlock(facts, oldMessages);

  // Estimate savings
  const oldTokens = estimateTokens(oldMessages);
  const contextBlockTokens = Math.ceil(contextBlock.length / CHARS_PER_TOKEN);
  const estimatedTokensSaved = Math.max(0, oldTokens - contextBlockTokens);

  // Also include any system messages from original array in recent
  const systemMessages = messages.filter(m => m.role === 'system');

  return {
    contextBlock,
    recentMessages: [...systemMessages, ...recentMessages],
    wasCompressed: true,
    stats: {
      originalCount: messages.length,
      summarizedCount: oldMessages.length,
      recentCount: recentMessages.length + systemMessages.length,
      estimatedTokensSaved
    }
  };
}

/**
 * Build the final message array for the LLM API call,
 * with context compression applied when needed.
 *
 * @param systemPrompt  The main system prompt (instructions, tools, etc.)
 * @param messages      Full conversation history
 * @param contextTokens The model's context window (num_ctx)
 * @returns Ready-to-send message array
 */
export function buildCompressedMessages(
  systemPrompt: string,
  messages: ChatMessage[],
  contextTokens: number
): { apiMessages: ChatMessage[]; compressed: CompressedHistory } {
  const compressed = compressConversation(messages, contextTokens, systemPrompt.length);

  if (!compressed.wasCompressed) {
    return {
      apiMessages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      compressed
    };
  }

  // Inject context block into system prompt
  const enhancedSystemPrompt = `${systemPrompt}\n\n${compressed.contextBlock}`;

  return {
    apiMessages: [
      { role: 'system', content: enhancedSystemPrompt },
      ...compressed.recentMessages
    ],
    compressed
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function deduplicate(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter(item => {
    const lower = item.toLowerCase();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });
}
