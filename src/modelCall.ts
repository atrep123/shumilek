import { Headers } from 'node-fetch';
import { fetchWithTimeout } from './fetchUtils';
import { getMaxOutputTokens, getContextTokens } from './configResolver';
import { buildCompressedMessages } from './contextMemory';
import { ChatMessage } from './types';

export async function executeModelCallWithMessages(
  baseUrl: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  timeout: number,
  abortSignal?: AbortSignal,
  forceJson?: boolean,
  log?: (msg: string) => void
): Promise<string> {
  const url = `${baseUrl}/api/chat`;
  const contextTokens = getContextTokens();
  const options = {
    repeat_penalty: 1.2,
    repeat_last_n: 256,
    num_predict: getMaxOutputTokens(forceJson ? 1024 : 2048),
    temperature: forceJson ? 0.1 : 0.3,
    num_ctx: contextTokens
  };
  const { apiMessages: compressedMsgs, compressed } = buildCompressedMessages(systemPrompt, messages, contextTokens);
  if (compressed.wasCompressed) {
    log?.(
      `[ContextMemory/executeModel] Compressed: ${compressed.stats.originalCount} msgs -> ` +
      `${compressed.stats.summarizedCount} summarized + ${compressed.stats.recentCount} recent`
    );
  }
  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: compressedMsgs,
    options
  };
  if (forceJson) {
    body.format = 'json';
  }
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal: abortSignal
  }, timeout);

  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';
  let lastChunkAt = Date.now();
  const STREAM_STALL_MS = 15000;

  for await (const chunk of res.body as any) {
    if (!chunk) continue;
    const now = Date.now();
    if (now - lastChunkAt > STREAM_STALL_MS && fullResponse.length > 50) {
      log?.('[executeModelCallWithMessages] Stream stall detected, aborting');
      break;
    }
    lastChunkAt = now;
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.message?.content) {
          fullResponse += parsed.message.content;
        }
      } catch {
        // Ignore malformed JSON
      }
    }
  }

  return fullResponse;
}
