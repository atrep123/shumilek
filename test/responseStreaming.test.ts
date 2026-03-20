import { strict as assert } from 'assert';

import { streamPlainOllamaChat } from '../src/responseStreaming';

function createPanel(messages: any[]) {
  return {
    visible: true,
    webview: {
      postMessage: async (message: unknown) => {
        messages.push(message);
        return true;
      }
    }
  } as any;
}

function createStream(chunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield Buffer.from(chunk, 'utf8');
      }
    }
  };
}

describe('responseStreaming', () => {
  it('streams response chunks and returns concatenated output', async () => {
    const webviewMessages: any[] = [];
    const logs: string[] = [];
    const abortCtrl = new AbortController();

    const result = await streamPlainOllamaChat({
      url: 'http://example.test',
      model: 'test-model',
      apiMessages: [{ role: 'user', content: 'hello' }],
      timeout: 1000,
      panel: createPanel(webviewMessages),
      abortCtrl,
      guardianEnabled: false,
      log: message => logs.push(message),
      fetchWithTimeoutFn: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createStream([
          '{"message":{"content":"Ahoj"}}\n',
          '{"message":{"content":" světe"}}\n'
        ])
      }) as any
    });

    assert.equal(result, 'Ahoj světe');
    assert.deepEqual(logs, []);
    assert.deepEqual(
      webviewMessages.filter(message => message.type === 'responseChunk').map(message => message.text),
      ['Ahoj', ' světe']
    );
  });

  it('throws on non-ok HTTP response', async () => {
    const abortCtrl = new AbortController();

    await assert.rejects(
      () => streamPlainOllamaChat({
        url: 'http://example.test',
        model: 'test-model',
        apiMessages: [{ role: 'user', content: 'hello' }],
        timeout: 1000,
        panel: createPanel([]),
        abortCtrl,
        guardianEnabled: false,
        fetchWithTimeoutFn: async () => ({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          body: null
        }) as any
      }),
      /HTTP 503: Service Unavailable/
    );
  });

  it('ignores malformed JSON lines and continues streaming valid deltas', async () => {
    const webviewMessages: any[] = [];
    const abortCtrl = new AbortController();

    const result = await streamPlainOllamaChat({
      url: 'http://example.test',
      model: 'test-model',
      apiMessages: [{ role: 'user', content: 'hello' }],
      timeout: 1000,
      panel: createPanel(webviewMessages),
      abortCtrl,
      guardianEnabled: false,
      fetchWithTimeoutFn: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createStream([
          'not-json\n',
          '{"message":{"content":"valid"}}\n'
        ])
      }) as any
    });

    assert.equal(result, 'valid');
    assert.deepEqual(
      webviewMessages.filter(message => message.type === 'responseChunk').map(message => message.text),
      ['valid']
    );
  });

  it('stops on stall after partial output and logs guardian warning', async () => {
    const webviewMessages: any[] = [];
    const logs: string[] = [];
    const abortCtrl = new AbortController();
    const times = [0, 1000, 13050];

    const result = await streamPlainOllamaChat({
      url: 'http://example.test',
      model: 'test-model',
      apiMessages: [{ role: 'user', content: 'hello' }],
      timeout: 1000,
      panel: createPanel(webviewMessages),
      abortCtrl,
      guardianEnabled: false,
      log: message => logs.push(message),
      now: () => times.shift() ?? 13050,
      fetchWithTimeoutFn: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createStream([
          `{"message":{"content":"${'a'.repeat(120)}"}}\n`,
          '{"message":{"content":"tail"}}\n'
        ])
      }) as any
    });

    assert.equal(result, 'a'.repeat(120));
    assert.ok(logs.some(message => message.includes('Stall detected')));
    assert.deepEqual(
      webviewMessages.filter(message => message.type === 'responseChunk').map(message => message.text),
      ['a'.repeat(120)]
    );
  });

  it('aborts on buffer overflow before parsing oversized buffered content', async () => {
    const logs: string[] = [];
    const abortCtrl = new AbortController();

    const result = await streamPlainOllamaChat({
      url: 'http://example.test',
      model: 'test-model',
      apiMessages: [{ role: 'user', content: 'hello' }],
      timeout: 1000,
      panel: createPanel([]),
      abortCtrl,
      guardianEnabled: false,
      log: message => logs.push(message),
      fetchWithTimeoutFn: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createStream(['x'.repeat(100001)])
      }) as any
    });

    assert.equal(result, '');
    assert.equal(abortCtrl.signal.aborted, true);
    assert.ok(logs.some(message => message.includes('Buffer overflow detected')));
  });

  it('detects real-time looping, posts guardian alert, and aborts generation', async () => {
    const webviewMessages: any[] = [];
    const logs: string[] = [];
    const abortCtrl = new AbortController();
    const repeated = 'abcdef'.repeat(10);

    const result = await streamPlainOllamaChat({
      url: 'http://example.test',
      model: 'test-model',
      apiMessages: [{ role: 'user', content: 'hello' }],
      timeout: 1000,
      panel: createPanel(webviewMessages),
      abortCtrl,
      guardianEnabled: true,
      log: message => logs.push(message),
      fetchWithTimeoutFn: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createStream([
          `{"message":{"content":"${repeated}"}}\n`,
          `{"message":{"content":"${repeated}"}}\n`
        ])
      }) as any
    });

    assert.equal(result, repeated.repeat(2));
    assert.equal(abortCtrl.signal.aborted, true);
    assert.ok(logs.some(message => message.includes('Real-time loop detected')));
    assert.ok(webviewMessages.some(message => message.type === 'guardianAlert'));
  });

  it('logs malformed JSON lines instead of silently ignoring them', async () => {
    const webviewMessages: any[] = [];
    const logs: string[] = [];
    const abortCtrl = new AbortController();

    await streamPlainOllamaChat({
      url: 'http://example.test',
      model: 'test-model',
      apiMessages: [{ role: 'user', content: 'hello' }],
      timeout: 1000,
      panel: createPanel(webviewMessages),
      abortCtrl,
      guardianEnabled: false,
      log: message => logs.push(message),
      fetchWithTimeoutFn: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createStream([
          'CORRUPT_DATA\n',
          '{"message":{"content":"ok"}}\n'
        ])
      }) as any
    });

    assert.ok(logs.some(l => l.includes('Malformed JSON') && l.includes('CORRUPT')));
  });

  it('calls abort() idempotently without checking signal.aborted first', async () => {
    const webviewMessages: any[] = [];
    const logs: string[] = [];
    const abortCtrl = new AbortController();
    // Pre-abort the controller
    abortCtrl.abort();

    // Buffer overflow path should still call abort() without throwing
    const bigChunk = 'X'.repeat(110000) + '\n';
    const result = await streamPlainOllamaChat({
      url: 'http://example.test',
      model: 'test-model',
      apiMessages: [{ role: 'user', content: 'hello' }],
      timeout: 1000,
      panel: createPanel(webviewMessages),
      abortCtrl,
      guardianEnabled: false,
      log: message => logs.push(message),
      fetchWithTimeoutFn: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createStream([bigChunk])
      }) as any
    });

    assert.equal(result, '');
    assert.equal(abortCtrl.signal.aborted, true);
  });

  it('parses residual buffer when stream ends without trailing newline', async () => {
    const webviewMessages: any[] = [];
    const logs: string[] = [];
    const abortCtrl = new AbortController();

    // Stream ends with a valid JSON line that has no trailing newline
    const result = await streamPlainOllamaChat({
      url: 'http://example.test',
      model: 'test-model',
      apiMessages: [{ role: 'user', content: 'hello' }],
      timeout: 1000,
      panel: createPanel(webviewMessages),
      abortCtrl,
      guardianEnabled: false,
      log: message => logs.push(message),
      fetchWithTimeoutFn: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createStream([
          '{"message":{"content":"first"}}\n',
          '{"message":{"content":" second"}}'  // No trailing newline
        ])
      }) as any
    });

    assert.equal(result, 'first second');
    const chunks = webviewMessages.filter(m => m.type === 'responseChunk').map(m => m.text);
    assert.deepEqual(chunks, ['first', ' second']);
  });

  it('logs residual buffer that is not valid JSON', async () => {
    const webviewMessages: any[] = [];
    const logs: string[] = [];
    const abortCtrl = new AbortController();

    const result = await streamPlainOllamaChat({
      url: 'http://example.test',
      model: 'test-model',
      apiMessages: [{ role: 'user', content: 'hello' }],
      timeout: 1000,
      panel: createPanel(webviewMessages),
      abortCtrl,
      guardianEnabled: false,
      log: message => logs.push(message),
      fetchWithTimeoutFn: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createStream([
          '{"message":{"content":"ok"}}\n',
          '{"message":{"content":"trunc'  // Truncated JSON
        ])
      }) as any
    });

    assert.equal(result, 'ok');
    assert.ok(logs.some(l => l.includes('Residual buffer not valid JSON')));
  });

  it('enforces global line limit across multiple chunks', async () => {
    const webviewMessages: any[] = [];
    const logs: string[] = [];
    const abortCtrl = new AbortController();

    // Generate 20 chunks each with 600 lines → 12000 total, should hit 10000 limit
    // Each chunk is ~16.8KB (well under 100KB buffer limit)
    const makeBigChunk = (count: number) => {
      let chunk = '';
      for (let i = 0; i < count; i++) {
        chunk += `{"message":{"content":"x"}}\n`;
      }
      return chunk;
    };
    const chunks: string[] = [];
    for (let c = 0; c < 20; c++) chunks.push(makeBigChunk(600));

    const result = await streamPlainOllamaChat({
      url: 'http://example.test',
      model: 'test-model',
      apiMessages: [{ role: 'user', content: 'hello' }],
      timeout: 1000,
      panel: createPanel(webviewMessages),
      abortCtrl,
      guardianEnabled: false,
      log: message => logs.push(message),
      fetchWithTimeoutFn: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createStream(chunks)
      }) as any
    });

    // Should have processed exactly 10000 lines worth of content
    assert.equal(result.length, 10000, 'should have exactly 10000 x chars');
    assert.ok(logs.some(l => l.includes('Stream processing limit reached')));
  });

  it('destroys response body on stall early break', async () => {
    const logs: string[] = [];
    let destroyCalled = false;
    const abortCtrl = new AbortController();
    const times = [0, 1000, 13050];

    const stream = createStream([
      `{"message":{"content":"${'a'.repeat(120)}"}}\n`,
      '{"message":{"content":"tail"}}\n'
    ]);
    (stream as any).destroy = () => { destroyCalled = true; };

    await streamPlainOllamaChat({
      url: 'http://example.test',
      model: 'test-model',
      apiMessages: [{ role: 'user', content: 'hello' }],
      timeout: 1000,
      panel: createPanel([]),
      abortCtrl,
      guardianEnabled: false,
      log: message => logs.push(message),
      now: () => times.shift() ?? 13050,
      fetchWithTimeoutFn: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: stream
      }) as any
    });

    assert.ok(destroyCalled, 'body.destroy() should be called on stall');
    assert.ok(logs.some(l => l.includes('Stall detected')));
  });

  it('destroys response body on buffer overflow early break', async () => {
    const logs: string[] = [];
    let destroyCalled = false;
    const abortCtrl = new AbortController();

    const stream = createStream(['x'.repeat(100001)]);
    (stream as any).destroy = () => { destroyCalled = true; };

    await streamPlainOllamaChat({
      url: 'http://example.test',
      model: 'test-model',
      apiMessages: [{ role: 'user', content: 'hello' }],
      timeout: 1000,
      panel: createPanel([]),
      abortCtrl,
      guardianEnabled: false,
      log: message => logs.push(message),
      fetchWithTimeoutFn: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: stream
      }) as any
    });

    assert.ok(destroyCalled, 'body.destroy() should be called on buffer overflow');
    assert.ok(logs.some(l => l.includes('Buffer overflow detected')));
  });
});