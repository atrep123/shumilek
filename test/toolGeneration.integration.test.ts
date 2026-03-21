const mock = require('mock-require');
const { strict: assert } = require('assert');

const { vscodeMock } = require('./helpers/vscodeMockShared');

mock('vscode', vscodeMock);

const { generateWithTools } = require('../src/toolGeneration');

function toolCall(name: string, argumentsValue?: Record<string, unknown>) {
  return `<tool_call>${JSON.stringify({ name, arguments: argumentsValue })}</tool_call>`;
}

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

function createDeps(overrides?: Partial<any>) {
  return {
    log: () => undefined,
    postToAllWebviews: () => undefined,
    getMutationHandlerDeps: () => ({}) as any,
    ...overrides
  };
}

describe('toolGeneration integration', () => {
  it('self-corrects after diagnostics and returns corrected mutation message', async () => {
    const panelMessages: any[] = [];
    const modelResponses = [
      toolCall('write_file', { path: 'src/a.ts', text: 'bad' }),
      toolCall('replace_lines', { path: 'src/a.ts', startLine: 1, endLine: 1, newLines: ['good'] })
    ];
    const diagRuns = [
      [{ path: 'src/a.ts', line: 1, message: 'Syntax error', severity: 'error' }],
      []
    ];
    const session: any = {
      hadMutations: false,
      lastWritePath: 'src/a.ts',
      toolCallRecords: []
    };
    const logs: string[] = [];

    const result = await generateWithTools(
      createPanel(panelMessages),
      'http://example.test',
      'primary-model',
      'system',
      [{ role: 'user', content: 'fix file' }],
      1000,
      6,
      false,
      createDeps({
        log: (message: string) => logs.push(message),
        executeModelCallWithMessagesFn: async () => modelResponses.shift() || '',
        runToolCallFn: async (_panel: any, call: any) => ({
          ok: true,
          tool: call.name,
          message: 'ok'
        }),
        collectPostWriteDiagnosticsFn: async () => diagRuns.shift() || []
      }),
      { requireToolCall: true, requireMutation: true },
      undefined,
      undefined,
      session
    );

    assert.equal(result, 'Hotovo: zmena souboru provedena (src/a.ts). (auto-corrected 1x)');
    assert.ok(logs.some(message => message.includes('[SelfCorrect] Attempt 1/3')));
    assert.ok(panelMessages.some(message => (message as any).type === 'pipelineStatus'));
    assert.equal(session.toolCallRecords.length, 2);
  });

  it('stops retrying after maxSelfCorrections and returns the capped correction note', async () => {
    const modelResponses = new Array(4).fill(
      toolCall('write_file', { path: 'src/a.ts', text: 'still bad' })
    );
    const session: any = {
      hadMutations: true,
      lastWritePath: 'src/a.ts',
      toolCallRecords: []
    };
    let diagCalls = 0;

    const result = await generateWithTools(
      createPanel([]),
      'http://example.test',
      'primary-model',
      'system',
      [{ role: 'user', content: 'fix file' }],
      1000,
      6,
      false,
      createDeps({
        executeModelCallWithMessagesFn: async () => modelResponses.shift() || '',
        runToolCallFn: async (_panel: any, call: any) => ({ ok: true, tool: call.name, message: 'ok' }),
        collectPostWriteDiagnosticsFn: async () => {
          diagCalls++;
          return [{ path: 'src/a.ts', line: 1, message: 'Still broken', severity: 'error' }];
        }
      }),
      { requireToolCall: true, requireMutation: true },
      undefined,
      undefined,
      session
    );

    assert.equal(result, 'Hotovo: zmena souboru provedena (src/a.ts). (auto-corrected 3x)');
    assert.equal(diagCalls, 3);
    assert.equal(session.toolCallRecords.length, 4);
  });

  it('rejects fabricated mutation when all write operations fail', async () => {
    const session: any = {
      hadMutations: false,
      lastWritePath: 'src/a.ts',
      toolCallRecords: []
    };
    const logs: string[] = [];

    const result = await generateWithTools(
      createPanel([]),
      'http://example.test',
      'primary-model',
      'system',
      [{ role: 'user', content: 'fix file' }],
      1000,
      2,
      false,
      createDeps({
        log: (message: string) => logs.push(message),
        executeModelCallWithMessagesFn: async () => toolCall('write_file', { path: 'src/a.ts', text: 'bad' }),
        runToolCallFn: async (_panel: any, call: any) => ({ ok: false, tool: call.name, message: 'permission denied' })
      }),
      { requireToolCall: true, requireMutation: false },
      undefined,
      undefined,
      session
    );

    assert.equal(result, 'Chyba: vsechny zapisy selhaly. Soubory nebyly zmeneny.');
    assert.ok(logs.some(message => message.includes('WARNING: All write operations failed')));
  });

  it('returns mutation-required error when only non-mutating tools succeed', async () => {
    const session: any = {
      hadMutations: false,
      toolCallRecords: []
    };

    const result = await generateWithTools(
      createPanel([]),
      'http://example.test',
      'primary-model',
      'system',
      [{ role: 'user', content: 'inspect file' }],
      1000,
      1,
      false,
      createDeps({
        executeModelCallWithMessagesFn: async () => toolCall('read_file', { path: 'src/a.ts' }),
        runToolCallFn: async (_panel: any, call: any) => ({ ok: true, tool: call.name, message: 'ok' })
      }),
      { requireToolCall: true, requireMutation: true },
      undefined,
      undefined,
      session
    );

    assert.equal(result, 'Chyba: nebyla provedena zadna zmena souboru. Pouzij write_file nebo replace_lines.');
  });

  it('respects pre-aborted abortSignal and throws AbortError', async () => {
    const ac = new AbortController();
    ac.abort();
    let modelCalled = false;

    await assert.rejects(
      () => generateWithTools(
        createPanel([]),
        'http://example.test',
        'primary-model',
        'system',
        [{ role: 'user', content: 'do work' }],
        1000,
        6,
        false,
        createDeps({
          executeModelCallWithMessagesFn: async () => { modelCalled = true; return 'hello'; }
        }),
        undefined,
        undefined,
        ac.signal,
        undefined,
        undefined
      ),
      (err: any) => {
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );
    assert.equal(modelCalled, false, 'model should not be called when signal is already aborted');
  });

  it('respects abortSignal aborted mid-iteration', async () => {
    const ac = new AbortController();
    let callCount = 0;

    await assert.rejects(
      () => generateWithTools(
        createPanel([]),
        'http://example.test',
        'primary-model',
        'system',
        [{ role: 'user', content: 'do work' }],
        1000,
        6,
        false,
        createDeps({
          executeModelCallWithMessagesFn: async () => {
            callCount++;
            // Abort after first iteration — model returns a tool call to trigger loop
            ac.abort();
            return toolCall('read_file', { path: 'src/a.ts' });
          },
          runToolCallFn: async () => ({ ok: true, tool: 'read_file', message: 'content' })
        }),
        undefined,
        undefined,
        ac.signal,
        undefined,
        undefined
      ),
      (err: any) => {
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );
    assert.equal(callCount, 1, 'should stop after first iteration when aborted');
  });

  it('tracks apply_patch as localMutation and in writes filter', async () => {
    const session: any = {
      hadMutations: false,
      toolCallRecords: []
    };
    const logs: string[] = [];

    // apply_patch fails → should be caught by writes filter
    const result = await generateWithTools(
      createPanel([]),
      'http://example.test',
      'primary-model',
      'system',
      [{ role: 'user', content: 'patch file' }],
      1000,
      2,
      false,
      createDeps({
        log: (message: string) => logs.push(message),
        executeModelCallWithMessagesFn: async () => toolCall('apply_patch', { diff: 'bad' }),
        runToolCallFn: async (_panel: any, call: any) => ({ ok: false, tool: call.name, message: 'patch failed' })
      }),
      { requireToolCall: true, requireMutation: false },
      undefined,
      undefined,
      session
    );

    assert.equal(result, 'Chyba: vsechny zapisy selhaly. Soubory nebyly zmeneny.');
    assert.ok(logs.some(message => message.includes('WARNING: All write operations failed')));
  });

  it('sets localMutation for successful apply_patch when session is undefined', async () => {
    const result = await generateWithTools(
      createPanel([]),
      'http://example.test',
      'primary-model',
      'system',
      [{ role: 'user', content: 'patch file' }],
      1000,
      1,
      false,
      createDeps({
        executeModelCallWithMessagesFn: async () => toolCall('apply_patch', { diff: '...' }),
        runToolCallFn: async (_panel: any, call: any) => ({ ok: true, tool: call.name, message: 'applied' }),
        collectPostWriteDiagnosticsFn: async () => []
      }),
      { requireToolCall: true, requireMutation: true },
      undefined,
      undefined,
      undefined // no session
    );

    assert.ok(result.includes('Hotovo'), 'should recognize apply_patch as mutation');
  });

  it('caps toolCallRecords at 200 entries', async () => {
    // model returns 1 call per iteration, loop runs up to 10 iterations but
    // we only need to verify the cap behaviour so we simulate many tool calls
    // via a single iteration returning many calls
    const session: any = {
      hadMutations: false,
      lastWritePath: undefined,
      toolCallRecords: []
    };
    // Pre-fill 199 records
    for (let i = 0; i < 199; i++) {
      session.toolCallRecords.push({ tool: `pre_${i}`, args: {}, ok: true, message: 'ok' });
    }

    const result = await generateWithTools(
      createPanel([]),
      'http://example.test',
      'm',
      'sys',
      [{ role: 'user', content: 'do it' }],
      1000,
      1,
      false,
      createDeps({
        executeModelCallWithMessagesFn: async () =>
          toolCall('read_file', { path: 'a.ts' }) + toolCall('read_file', { path: 'b.ts' }) + toolCall('read_file', { path: 'c.ts' }),
        runToolCallFn: async (_panel: any, call: any) => ({ ok: true, tool: call.name, message: 'ok' }),
        collectPostWriteDiagnosticsFn: async () => []
      }),
      undefined,
      undefined,
      undefined,
      session
    );

    // 199 pre-filled + at most 1 new = 200 cap
    assert.ok(session.toolCallRecords.length <= 200, `Expected <= 200, got ${session.toolCallRecords.length}`);
  });

  it('truncates large args in toolCallRecords', async () => {
    const session: any = {
      hadMutations: false,
      lastWritePath: undefined,
      toolCallRecords: []
    };
    const bigContent = 'x'.repeat(5000);

    const result = await generateWithTools(
      createPanel([]),
      'http://example.test',
      'm',
      'sys',
      [{ role: 'user', content: 'write' }],
      1000,
      1,
      false,
      createDeps({
        executeModelCallWithMessagesFn: async () =>
          toolCall('write_file', { path: 'big.ts', text: bigContent }),
        runToolCallFn: async (_panel: any, call: any) => ({ ok: true, tool: call.name, message: 'ok' }),
        collectPostWriteDiagnosticsFn: async () => []
      }),
      undefined,
      undefined,
      undefined,
      session
    );

    const record = session.toolCallRecords[0];
    assert.ok(record, 'should have 1 record');
    // Args should be truncated to _truncated with max 2000 chars
    assert.ok(record.args._truncated, 'should have _truncated field');
    assert.ok(record.args._truncated.length <= 2000, `Expected <= 2000, got ${record.args._truncated.length}`);
  });
});