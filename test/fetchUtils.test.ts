const mock = require('mock-require');
const { strict: assert } = require('assert');

function loadFetchUtils(fetchImpl: (...args: any[]) => Promise<any>) {
  mock.stopAll();
  mock('node-fetch', {
    __esModule: true,
    default: fetchImpl
  });
  return mock.reRequire('../src/fetchUtils');
}

describe('fetchUtils', () => {
  afterEach(() => {
    mock.stopAll();
  });

  it('passes a managed abort signal to fetch and returns the response on success', async () => {
    const calls: any[] = [];
    const response = { ok: true, status: 200 };
    const { fetchWithTimeout } = loadFetchUtils(async (url: string, options: any) => {
      calls.push({ url, options });
      return response;
    });

    const originalController = new AbortController();
    const result = await fetchWithTimeout(
      'http://example.test',
      { method: 'POST', body: 'x', signal: originalController.signal },
      1000
    );

    assert.equal(result, response);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://example.test');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.body, 'x');
    assert.ok(calls[0].options.signal instanceof AbortSignal);
    assert.notEqual(calls[0].options.signal, originalController.signal);
    assert.equal(calls[0].options.signal.aborted, false);
  });

  it('forwards caller aborts into the managed fetch signal', async () => {
    let forwardedSignal: AbortSignal | undefined;
    const { fetchWithTimeout } = loadFetchUtils(async (_url: string, options: any) => {
      forwardedSignal = options.signal;
      return await new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted by caller')), { once: true });
      });
    });

    const originalController = new AbortController();
    const pending = fetchWithTimeout(
      'http://example.test',
      { signal: originalController.signal },
      5000
    );

    originalController.abort();

    await assert.rejects(() => pending, /aborted by caller/);
    assert.equal(forwardedSignal?.aborted, true);
  });

  it('aborts the managed fetch signal when the timeout elapses', async () => {
    let forwardedSignal: AbortSignal | undefined;
    const { fetchWithTimeout } = loadFetchUtils(async (_url: string, options: any) => {
      forwardedSignal = options.signal;
      return await new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')), { once: true });
      });
    });

    await assert.rejects(
      () => fetchWithTimeout('http://example.test', {}, 10),
      /aborted by timeout/
    );

    assert.equal(forwardedSignal?.aborted, true);
  });
});