import { ChatMessage } from './types';

export interface ObsidianArchiveStats {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  systemMessages: number;
  totalCharacters: number;
  firstTimestamp?: number;
  lastTimestamp?: number;
}

export interface ObsidianArchiveResult {
  fileName: string;
  markdown: string;
  stats: ObsidianArchiveStats;
}

export interface ObsidianArchiveOptions {
  projectName?: string;
  tags?: string[];
}

function formatIsoTimestamp(ts?: number): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return 'n/a';
  return new Date(ts).toISOString();
}

function formatDayKey(ts?: number): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return 'unknown-day';
  return new Date(ts).toISOString().slice(0, 10);
}

function toYamlScalar(value: string): string {
  return JSON.stringify(value);
}

function toSlug(input: string, fallback: string): string {
  const normalized = input
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function inferTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user' && m.content.trim().length > 0);
  const seed = firstUser ? firstUser.content.slice(0, 80) : 'chat-history';
  return toSlug(seed, 'chat-history');
}

function roleLabel(role: ChatMessage['role']): string {
  if (role === 'assistant') return 'assistant';
  if (role === 'system') return 'system';
  return 'user';
}

function collectStats(messages: ChatMessage[]): ObsidianArchiveStats {
  const stats: ObsidianArchiveStats = {
    totalMessages: messages.length,
    userMessages: 0,
    assistantMessages: 0,
    systemMessages: 0,
    totalCharacters: 0,
    firstTimestamp: undefined,
    lastTimestamp: undefined
  };

  for (const msg of messages) {
    if (msg.role === 'user') stats.userMessages += 1;
    else if (msg.role === 'assistant') stats.assistantMessages += 1;
    else stats.systemMessages += 1;

    stats.totalCharacters += msg.content.length;

    if (typeof msg.timestamp === 'number' && Number.isFinite(msg.timestamp)) {
      if (typeof stats.firstTimestamp !== 'number' || msg.timestamp < stats.firstTimestamp) {
        stats.firstTimestamp = msg.timestamp;
      }
      if (typeof stats.lastTimestamp !== 'number' || msg.timestamp > stats.lastTimestamp) {
        stats.lastTimestamp = msg.timestamp;
      }
    }
  }

  return stats;
}

export function buildObsidianChatArchive(
  messages: ChatMessage[],
  optionsOrNow: ObsidianArchiveOptions | Date = {},
  maybeNow?: Date
): ObsidianArchiveResult {
  const options = optionsOrNow instanceof Date ? {} : optionsOrNow;
  const now = optionsOrNow instanceof Date ? optionsOrNow : (maybeNow ?? new Date());
  const generatedAtIso = now.toISOString();
  const dateStamp = generatedAtIso.slice(0, 10);
  const timeStamp = generatedAtIso.slice(11, 19).replace(/:/g, '-');
  const slug = inferTitle(messages);
  const title = `Sumilek Chat Archive ${dateStamp}`;
  const fileName = `shumilek-history-${dateStamp}-${timeStamp}-${slug}.md`;
  const stats = collectStats(messages);
  const projectName = options.projectName?.trim();
  const tags = Array.from(new Set(['shumilek', 'chat', 'archive', 'obsidian', ...(options.tags ?? [])]));

  const lines: string[] = [];
  lines.push('---');
  lines.push('type: shumilek-chat-archive');
  lines.push(`created: ${generatedAtIso}`);
  lines.push(`title: ${toYamlScalar(title)}`);
  lines.push(`slug: ${slug}`);
  if (projectName) {
    lines.push(`project: ${toYamlScalar(projectName)}`);
  }
  lines.push(`tags: [${tags.join(', ')}]`);
  lines.push(`messages: ${stats.totalMessages}`);
  lines.push(`user_messages: ${stats.userMessages}`);
  lines.push(`assistant_messages: ${stats.assistantMessages}`);
  lines.push(`system_messages: ${stats.systemMessages}`);
  lines.push(`characters: ${stats.totalCharacters}`);
  lines.push(`first_message_at: ${toYamlScalar(formatIsoTimestamp(stats.firstTimestamp))}`);
  lines.push(`last_message_at: ${toYamlScalar(formatIsoTimestamp(stats.lastTimestamp))}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${title}`);
  lines.push('');
  lines.push('## Summary');
  if (projectName) {
    lines.push(`- Project: ${projectName}`);
  }
  lines.push(`- Total messages: ${stats.totalMessages}`);
  lines.push(`- User: ${stats.userMessages}`);
  lines.push(`- Assistant: ${stats.assistantMessages}`);
  lines.push(`- System: ${stats.systemMessages}`);
  lines.push(`- Total characters: ${stats.totalCharacters}`);
  lines.push(`- First message: ${formatIsoTimestamp(stats.firstTimestamp)}`);
  lines.push(`- Last message: ${formatIsoTimestamp(stats.lastTimestamp)}`);
  lines.push('');
  lines.push('## Timeline');
  lines.push('');

  if (messages.length === 0) {
    lines.push('_No chat messages to archive._');
  } else {
    let currentDay: string | undefined;
    for (const message of messages) {
      const dayKey = formatDayKey(message.timestamp);
      if (dayKey !== currentDay) {
        currentDay = dayKey;
        lines.push(`### ${dayKey}`);
        lines.push('');
      }
      lines.push(`#### ${roleLabel(message.role)} @ ${formatIsoTimestamp(message.timestamp)}`);
      lines.push('');
      lines.push(message.content.trim().length > 0 ? message.content : '_Empty message_');
      lines.push('');
    }
  }

  return {
    fileName,
    markdown: lines.join('\n').trimEnd() + '\n',
    stats
  };
}
