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
  let earlyBreak = false;

  try {
    for await (const chunk of res.body as any) {
      if (!chunk) continue;
      const now = Date.now();
      if (now - lastChunkAt > STREAM_STALL_MS && fullResponse.length > 50) {
        log?.('[executeModelCallWithMessages] Stream stall detected, aborting');
        fullResponse += '\n\n[Odpověď zkrácena – stream stall]';
        earlyBreak = true;
        break;
      }
      lastChunkAt = now;
      buffer += decoder.decode(chunk, { stream: true });

      if (buffer.length > 1_000_000) {
        log?.('[executeModelCallWithMessages] Buffer overflow, aborting');
        fullResponse += '\n\n[Odpověď zkrácena – buffer overflow]';
        earlyBreak = true;
        break;
      }

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content && typeof parsed.message.content === 'string') {
            fullResponse += parsed.message.content;
          }
        } catch {
          log?.(`[ModelCall] Malformed JSON: ${line.slice(0, 120)}`);
        }

        if (fullResponse.length > 500_000) {
          log?.('[executeModelCallWithMessages] Response too long, truncating');
          fullResponse = fullResponse.slice(0, 500_000) + '\n\n[Odpověď zkrácena – příliš dlouhá]';
          earlyBreak = true;
          break;
        }
      }
      if (earlyBreak) break;
    }
  } finally {
    // Destroy the response body to release the socket (no-op if already ended)
    if (res.body) {
      try {
        const body = res.body as any;
        if (typeof body.destroy === 'function') {
          body.destroy();
        }
      } catch {
        // ignore cleanup errors
      }
    }
  }

  // Flush remaining multi-byte characters from decoder
  const flushed = decoder.decode(new Uint8Array(0), { stream: false });
  if (flushed) buffer += flushed;

  // Process any remaining buffer content (last line without trailing newline)
  const remaining = buffer.trim();
  if (remaining) {
    try {
      const parsed = JSON.parse(remaining);
      if (parsed.message?.content) {
        fullResponse += parsed.message.content;
      }
    } catch {
      log?.(`[ModelCall] Malformed residual JSON: ${remaining.slice(0, 120)}`);
    }
  }

  return fullResponse;
}
