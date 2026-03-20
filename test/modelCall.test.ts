const mock = require('mock-require');
const { strict: assert } = require('assert');

function createStream(chunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield Buffer.from(chunk, 'utf8');
      }
    }
  };
}

function loadModelCall(overrides?: {
  fetchWithTimeout?: (...args: any[]) => Promise<any>;
  getContextTokens?: () => number;
  getMaxOutputTokens?: (fallback: number) => number;
  buildCompressedMessages?: (...args: any[]) => any;
}) {
  mock.stopAll();

  mock('../src/fetchUtils', {
    fetchWithTimeout: overrides?.fetchWithTimeout || (async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: createStream(['{"message":{"content":"ok"}}\n'])
    }))
  });
  mock('../src/configResolver', {
    getContextTokens: overrides?.getContextTokens || (() => 4096),
    getMaxOutputTokens: overrides?.getMaxOutputTokens || ((fallback: number) => fallback)
  });
  mock('../src/contextMemory', {
    buildCompressedMessages: overrides?.buildCompressedMessages || ((systemPrompt: string, messages: any[], contextTokens: number) => ({
      apiMessages: [{ role: 'system', content: systemPrompt }, ...messages],
      compressed: {
        wasCompressed: false,
        stats: { originalCount: messages.length, summarizedCount: 0, recentCount: messages.length }
      },
      contextTokens
    }))
  });

  return mock.reRequire('../src/modelCall');
}

describe('modelCall', () => {
  afterEach(() => {
    mock.stopAll();
  });

  it('builds chat request with compressed messages and forceJson options', async () => {
    const logs: string[] = [];
    const fetchCalls: any[] = [];
    const abortCtrl = new AbortController();
    const { executeModelCallWithMessages } = loadModelCall({
      fetchWithTimeout: async (url: string, options: any, timeout: number) => {
        fetchCalls.push({ url, options, timeout });
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          body: createStream(['{"message":{"content":"Ahoj"}}\n'])
        };
      },
      getContextTokens: () => 8192,
      getMaxOutputTokens: () => 777,
      buildCompressedMessages: () => ({
        apiMessages: [
          { role: 'system', content: 'compressed system' },
          { role: 'user', content: 'compressed user' }
        ],
        compressed: {
          wasCompressed: true,
          stats: { originalCount: 8, summarizedCount: 3, recentCount: 2 }
        }
      })
    });

    const result = await executeModelCallWithMessages(
      'http://example.test',
      'test-model',
      'system prompt',
      [{ role: 'user', content: 'hello' }],
      5000,
      abortCtrl.signal,
      true,
      message => logs.push(message)
    );

    assert.equal(result, 'Ahoj');
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'http://example.test/api/chat');
    assert.equal(fetchCalls[0].timeout, 5000);
    assert.equal(fetchCalls[0].options.signal, abortCtrl.signal);

    const body = JSON.parse(fetchCalls[0].options.body);
    assert.equal(body.model, 'test-model');
    assert.equal(body.stream, true);
    assert.equal(body.format, 'json');
    assert.deepEqual(body.messages, [
      { role: 'system', content: 'compressed system' },
      { role: 'user', content: 'compressed user' }
    ]);
    assert.deepEqual(body.options, {
      repeat_penalty: 1.2,
      repeat_last_n: 256,
      num_predict: 777,
      temperature: 0.1,
      num_ctx: 8192
    });
    assert.ok(logs.some(message => message.includes('Compressed: 8 msgs -> 3 summarized + 2 recent')));
  });

  it('throws on non-ok HTTP response or missing body', async () => {
    const { executeModelCallWithMessages } = loadModelCall({
      fetchWithTimeout: async () => ({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        body: null
      })
    });

    await assert.rejects(
      () => executeModelCallWithMessages(
        'http://example.test',
        'test-model',
        'system prompt',
        [{ role: 'user', content: 'hello' }],
        5000
      ),
      /HTTP 503: Service Unavailable/
    );
  });

  it('concatenates streamed content and ignores malformed JSON lines', async () => {
    const { executeModelCallWithMessages } = loadModelCall({
      fetchWithTimeout: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createStream([
          '{"message":{"content":"Hel',
          'lo"}}\nnot-json\n{"message":{"content":"!"}}\n'
        ])
      })
    });

    const result = await executeModelCallWithMessages(
      'http://example.test',
      'test-model',
      'system prompt',
      [{ role: 'user', content: 'hello' }],
      5000
    );

    assert.equal(result, 'Hello!');
  });

  it('logs malformed JSON lines via the log callback', async () => {
    const logs: string[] = [];
    const { executeModelCallWithMessages } = loadModelCall({
      fetchWithTimeout: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createStream([
          'BAD_LINE\n{"message":{"content":"ok"}}\n'
        ])
      })
    });

    const result = await executeModelCallWithMessages(
      'http://example.test',
      'test-model',
      'system prompt',
      [{ role: 'user', content: 'hello' }],
      5000,
      undefined,
      false,
      (message: string) => logs.push(message)
    );

    assert.equal(result, 'ok');
    assert.ok(logs.some((l: string) => l.includes('Malformed JSON') && l.includes('BAD_LINE')));
  });

  it('stops on stalled stream after partial output and logs the stall', async () => {
    const logs: string[] = [];
    const originalNow = Date.now;
    // lastChunkAt=0, generationStartMs=0, chunk1 now=1000, chunk2 now=17050
    const nowValues = [0, 0, 1000, 17050];
    Date.now = () => nowValues.shift() ?? 17050;

    try {
      const { executeModelCallWithMessages } = loadModelCall({
        fetchWithTimeout: async () => ({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: createStream([
            `{"message":{"content":"${'a'.repeat(60)}"}}\n`,
            '{"message":{"content":"tail"}}\n'
          ])
        })
      });

      const result = await executeModelCallWithMessages(
        'http://example.test',
        'test-model',
        'system prompt',
        [{ role: 'user', content: 'hello' }],
        5000,
        undefined,
        false,
        message => logs.push(message)
      );

      assert.ok(result.startsWith('a'.repeat(60)), 'should contain original content');
      assert.ok(result.includes('[Odpověď zkrácena'), 'should contain truncation marker');
      assert.ok(logs.some(message => message.includes('Stream stall detected')));
    } finally {
      Date.now = originalNow;
    }
  });

  it('aborts on buffer overflow when no newlines in stream', async () => {
    const logs: string[] = [];
    // 1.1MB chunk without newlines → exceeds 1MB buffer limit
    const bigChunk = '{"message":{"content":"' + 'X'.repeat(1_100_000) + '"}}';
    const { executeModelCallWithMessages } = loadModelCall({
      fetchWithTimeout: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createStream([bigChunk])
      })
    });

    const result = await executeModelCallWithMessages(
      'http://example.test',
      'test-model',
      'system prompt',
      [{ role: 'user', content: 'hello' }],
      5000,
      undefined,
      false,
      (message: string) => logs.push(message)
    );

    assert.ok(result.includes('[Odpověď zkrácena'), 'should contain buffer overflow marker');
    assert.ok(logs.some(l => l.includes('Buffer overflow')));
  });

  it('processes residual buffer content when last line has no trailing newline', async () => {
    const { executeModelCallWithMessages } = loadModelCall({
      fetchWithTimeout: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createStream([
          '{"message":{"content":"Hello"}}\n',
          '{"message":{"content":" World"}}' // no trailing newline
        ])
      })
    });

    const result = await executeModelCallWithMessages(
      'http://example.test',
      'test-model',
      'system prompt',
      [{ role: 'user', content: 'hello' }],
      5000
    );

    assert.equal(result, 'Hello World');
  });

  it('logs malformed residual buffer and does not crash', async () => {
    const logs: string[] = [];
    const { executeModelCallWithMessages } = loadModelCall({
      fetchWithTimeout: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createStream([
          '{"message":{"content":"ok"}}\n',
          'not-valid-json' // malformed residual
        ])
      })
    });

    const result = await executeModelCallWithMessages(
      'http://example.test',
      'test-model',
      'system prompt',
      [{ role: 'user', content: 'hello' }],
      5000,
      undefined,
      false,
      (message: string) => logs.push(message)
    );

    assert.equal(result, 'ok');
    assert.ok(logs.some(l => l.includes('Malformed residual JSON')));
  });

  it('destroys response body on stream stall early break', async () => {
    const logs: string[] = [];
    let destroyCalled = false;
    const originalNow = Date.now;
    // lastChunkAt=0, generationStartMs=0, chunk1 now=1000, chunk2 now=17050
    const nowValues = [0, 0, 1000, 17050];
    Date.now = () => nowValues.shift() ?? 17050;

    try {
      const stream = createStream([
        `{"message":{"content":"${'a'.repeat(60)}"}}\n`,
        '{"message":{"content":"tail"}}\n'
      ]);
      (stream as any).destroy = () => { destroyCalled = true; };

      const { executeModelCallWithMessages } = loadModelCall({
        fetchWithTimeout: async () => ({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: stream
        })
      });

      await executeModelCallWithMessages(
        'http://example.test',
        'test-model',
        'system prompt',
        [{ role: 'user', content: 'hello' }],
        5000,
        undefined,
        false,
        (message: string) => logs.push(message)
      );

      assert.ok(destroyCalled, 'body.destroy() should be called on stall');
      assert.ok(logs.some(l => l.includes('Stream stall detected')));
    } finally {
      Date.now = originalNow;
    }
  });

  it('destroys response body on buffer overflow early break', async () => {
    const logs: string[] = [];
    let destroyCalled = false;
    const bigChunk = '{"message":{"content":"' + 'X'.repeat(1_100_000) + '"}}';
    const stream = createStream([bigChunk]);
    (stream as any).destroy = () => { destroyCalled = true; };

    const { executeModelCallWithMessages } = loadModelCall({
      fetchWithTimeout: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: stream
      })
    });

    await executeModelCallWithMessages(
      'http://example.test',
      'test-model',
      'system prompt',
      [{ role: 'user', content: 'hello' }],
      5000,
      undefined,
      false,
      (message: string) => logs.push(message)
    );

    assert.ok(destroyCalled, 'body.destroy() should be called on buffer overflow');
    assert.ok(logs.some(l => l.includes('Buffer overflow')));
  });

  it('destroys response body when stream throws an exception', async () => {
    let destroyCalled = false;
    const errorStream = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('{"message":{"content":"partial"}}\n', 'utf8');
        throw new Error('network failure');
      },
      destroy() { destroyCalled = true; }
    };

    const { executeModelCallWithMessages } = loadModelCall({
      fetchWithTimeout: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: errorStream
      })
    });

    await assert.rejects(
      () => executeModelCallWithMessages(
        'http://example.test',
        'test-model',
        'system prompt',
        [{ role: 'user', content: 'hello' }],
        5000
      ),
      /network failure/
    );

    assert.ok(destroyCalled, 'body.destroy() should be called even when stream throws');
  });

  it('truncates response at 500KB and breaks out of stream', async () => {
    const logs: string[] = [];
    const bigContent = 'B'.repeat(100_000);
    const chunks: string[] = [];
    for (let i = 0; i < 10; i++) {
      chunks.push(`{"message":{"content":"${bigContent}"}}\n`);
    }

    let chunksConsumed = 0;
    const stream = {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          chunksConsumed++;
          yield Buffer.from(chunk, 'utf8');
        }
      },
      destroy() {}
    };

    const { executeModelCallWithMessages } = loadModelCall({
      fetchWithTimeout: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: stream
      })
    });

    const result = await executeModelCallWithMessages(
      'http://example.test',
      'test-model',
      'system prompt',
      [{ role: 'user', content: 'hello' }],
      5000,
      undefined,
      false,
      (msg: string) => logs.push(msg)
    );

    assert.ok(chunksConsumed < 10, `Should stop early; consumed ${chunksConsumed}`);
    assert.ok(result.includes('Odpověď zkrácena'), 'Should include truncation note');
    assert.ok(logs.some(l => l.includes('Response too long')));
  });

  it('skips non-string message.content values', async () => {
    const chunks = [
      '{"message":{"content":"hello "}}\n',
      '{"message":{"content":42}}\n',
      '{"message":{"content":null}}\n',
      '{"message":{"content":"world"}}\n'
    ];

    const { executeModelCallWithMessages } = loadModelCall({
      fetchWithTimeout: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: createStream(chunks)
      })
    });

    const result = await executeModelCallWithMessages(
      'http://example.test',
      'test-model',
      'system prompt',
      [{ role: 'user', content: 'hello' }],
      5000
    );

    assert.strictEqual(result, 'hello world');
  });

  it('detects stream stall even with short response when elapsed time exceeds 2× stall threshold', async () => {
    const logs: string[] = [];
    const originalNow = Date.now;
    // generationStartMs=0, lastChunkAt=0, then next chunk arrives at time=31000
    // lastChunkAt=0, generationStartMs=0, chunk1 now=1000, chunk2 now=31050
    // fullResponse.length < 50 but elapsed (31050) > STREAM_STALL_MS*2 (30000)
    const nowValues = [0, 0, 1000, 31050];
    Date.now = () => nowValues.shift() ?? 31050;

    try {
      const { executeModelCallWithMessages } = loadModelCall({
        fetchWithTimeout: async () => ({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: createStream([
            '{"message":{"content":"hi"}}\n',
            '{"message":{"content":"tail"}}\n'
          ])
        })
      });

      const result = await executeModelCallWithMessages(
        'http://example.test',
        'test-model',
        'system prompt',
        [{ role: 'user', content: 'hello' }],
        5000,
        undefined,
        false,
        (message: string) => logs.push(message)
      );

      assert.ok(result.includes('hi'), 'should contain first content');
      assert.ok(result.includes('[Odpověď zkrácena'), 'should contain stall marker');
      assert.ok(logs.some(l => l.includes('Stream stall detected')));
    } finally {
      Date.now = originalNow;
    }
  });
});