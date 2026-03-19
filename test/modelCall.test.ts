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
    const nowValues = [0, 1000, 17050];
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

      assert.equal(result, 'a'.repeat(60));
      assert.ok(logs.some(message => message.includes('Stream stall detected')));
    } finally {
      Date.now = originalNow;
    }
  });
});