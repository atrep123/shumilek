import { fetchWithTimeout } from './fetchUtils';
import { getMaxOutputTokens, getContextTokens } from './configResolver';
import { WebviewWrapper } from './types';

export async function streamPlainOllamaChat(opts: {
  url: string;
  model: string;
  apiMessages: Array<{role: string; content: string}>;
  timeout: number;
  panel: WebviewWrapper;
  abortCtrl: AbortController;
  guardianEnabled: boolean;
  log?: (msg: string) => void;
  fetchWithTimeoutFn?: typeof fetchWithTimeout;
  now?: () => number;
}): Promise<string> {
  const { url, model, apiMessages, timeout, panel, abortCtrl, guardianEnabled, log } = opts;
  const fetchImpl = opts.fetchWithTimeoutFn || fetchWithTimeout;
  const now = opts.now || (() => Date.now());
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      messages: apiMessages,
      options: {
        repeat_penalty: 1.2,
        repeat_last_n: 256,
        num_predict: getMaxOutputTokens(2048),
        num_ctx: getContextTokens()
      }
    }),
    signal: abortCtrl.signal
  }, timeout);

  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';
  let lastChunkTime = now();
  const STALL_TIMEOUT = 10000;

  let recentChunks: string[] = [];
  const CHUNK_WINDOW = 20;

  if (!res.body || typeof res.body[Symbol.asyncIterator] !== 'function') {
    throw new Error('Response body is not readable stream');
  }

  let globalLinesProcessed = 0;
  let earlyBreak = false;

  try {
    for await (const chunk of res.body as any) {
      if (!chunk) continue;
      const currentTime = now();
      if (currentTime - lastChunkTime > STALL_TIMEOUT && fullResponse.length > 100) {
        log?.('[Guardian] Stall detected, stopping generation');
        earlyBreak = true;
        break;
      }
      lastChunkTime = currentTime;

      buffer += decoder.decode(chunk, { stream: true });

      if (buffer.length > 100000) {
        log?.('[Error] Buffer overflow detected, stopping stream');
        abortCtrl.abort();
        earlyBreak = true;
        break;
      }

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        if (++globalLinesProcessed > 10000) {
          log?.('[Warning] Stream processing limit reached');
          break;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;

        try {
          const json = JSON.parse(line);
          if (!json || typeof json !== 'object') {
            continue;
          }
          if (!json.message || typeof json.message !== 'object') {
            continue;
          }
          const delta = json.message.content || '';
          if (delta) {
            fullResponse += delta;

            if (fullResponse.length > 500000) {
              log?.('[Warning] Response too long, truncating');
              fullResponse = fullResponse.slice(0, 500000) + '\n\n[Odpověď zkrácena - příliš dlouhá]';
              abortCtrl.abort();
              earlyBreak = true;
              break;
            }

            if (guardianEnabled) {
              recentChunks.push(delta);
              if (recentChunks.length > CHUNK_WINDOW) {
                recentChunks.shift();
              }

              const recentText = recentChunks.join('');
              if (recentText.length > 100) {
                const halfLen = Math.floor(recentText.length / 2);
                const firstHalf = recentText.slice(0, halfLen);
                const secondHalf = recentText.slice(recentText.length - halfLen);
                if (firstHalf === secondHalf && firstHalf.length > 0) {
                  log?.('[Guardian] Real-time loop detected, stopping');
                  panel.webview.postMessage({
                    type: 'guardianAlert',
                    message: '🛡️ Smyčka detekována, zastavuji generování'
                  });
                  abortCtrl.abort();
                  earlyBreak = true;
                  break;
                }
              }
            }

            panel.webview.postMessage({ type: 'responseChunk', text: delta });
          }
        } catch {
          log?.(`[Stream] Malformed JSON: ${line.slice(0, 120)}`);
        }
      }
      if (globalLinesProcessed > 10000) {
        earlyBreak = true;
        break;
      }
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

  // Parse any remaining buffered JSON line (stream ended without trailing newline)
  const residual = buffer.trim();
  if (residual) {
    try {
      const json = JSON.parse(residual);
      if (json?.message?.content) {
        fullResponse += json.message.content;
        panel.webview.postMessage({ type: 'responseChunk', text: json.message.content });
      }
    } catch {
      log?.(`[Stream] Residual buffer not valid JSON: ${residual.slice(0, 120)}`);
    }
  }

  return fullResponse;
}
