import { expect } from 'chai';
import {
  AirLLMRuntimeDeps,
  AirLLMStartupState,
  buildAirLLMStartCommandForExtension,
  ensureAirLLMRunning,
  startAirLLMServer
} from '../src/airllmRuntime';

type ConfigValue = string | boolean | number;

function configWith(overrides: Record<string, ConfigValue> = {}) {
  const defaults: Record<string, ConfigValue> = {
    'airllm.serverUrl': 'http://localhost:11435',
    'airllm.model': 'Qwen/Qwen2.5-72B-Instruct',
    'airllm.compression': 'none',
    'airllm.dtype': 'auto',
    'airllm.cacheDir': '',
    'airllm.useKvCache': false,
    'airllm.runInWsl': false,
    'airllm.wslDistro': 'Ubuntu',
    'airllm.wslUser': '',
    'airllm.startCommand': ''
  };
  const store = { ...defaults, ...overrides };
  return {
    get<T>(key: string, fallback: T): T {
      return (store[key] ?? fallback) as T;
    }
  };
}

function createPanel(messages: unknown[] = []) {
  return {
    visible: true,
    webview: {
      postMessage(message: unknown) {
        messages.push(message);
        return Promise.resolve(true);
      }
    }
  };
}

describe('airllmRuntime', () => {
  it('builds the extension-scoped AirLLM command from the extension path', () => {
    const result = buildAirLLMStartCommandForExtension('C:/repo/ext', configWith());

    expect(result.baseUrl).to.equal('http://localhost:11435');
    expect(result.command).to.include('airllm_server.py');
    expect(result.command).to.include('--preload');
  });

  it('reuses a single terminal and records the last start time', async () => {
    const commands: string[] = [];
    const shows: boolean[] = [];
    const terminal = {
      show(preserveFocus?: boolean) {
        shows.push(Boolean(preserveFocus));
      },
      sendText(text: string) {
        commands.push(text);
      }
    };
    const state: AirLLMStartupState = {};
    let now = 4242;
    let createCount = 0;

    await startAirLLMServer('C:/repo/ext', configWith(), state, {
      createTerminal: () => {
        createCount += 1;
        return terminal;
      },
      now: () => now,
      log: () => {}
    });

    now = 7777;
    await startAirLLMServer('C:/repo/ext', configWith(), state, {
      createTerminal: () => {
        createCount += 1;
        return terminal;
      },
      now: () => now,
      log: () => {}
    });

    expect(createCount).to.equal(1);
    expect(commands).to.have.length(2);
    expect(commands[0]).to.include('airllm_server.py');
    expect(shows).to.deep.equal([false, false]);
    expect(state.lastStartAt).to.equal(7777);
    expect(state.terminal).to.equal(terminal);
  });

  it('returns false without starting when auto-start is disabled', async () => {
    const fetchCalls: string[] = [];
    const state: AirLLMStartupState = {};
    let startCalls = 0;

    const ready = await ensureAirLLMRunning({
      baseUrl: 'http://localhost:11435',
      autoStart: false,
      waitForHealthySeconds: 30,
      startServer: async () => {
        startCalls += 1;
      }
    }, state, {
      fetchFn: async (url: string) => {
        fetchCalls.push(url);
        return { ok: true, json: async () => ({ status: 'starting' }) };
      },
      sleep: async () => {},
      now: () => 1000
    });

    expect(ready).to.equal(false);
    expect(startCalls).to.equal(0);
    expect(fetchCalls).to.deep.equal(['http://localhost:11435/health']);
    expect(state.startInProgress).to.equal(undefined);
  });

  it('reuses in-flight startup and posts panel status once', async () => {
    const fetchTimeouts: number[] = [];
    const panelMessages: unknown[] = [];
    const state: AirLLMStartupState = {};
    let now = 0;
    let healthyChecks = 0;
    let startCalls = 0;
    let releasePoll: (() => void) | undefined;
    const pollGate = new Promise<void>(resolve => {
      releasePoll = resolve;
    });

    const deps: Pick<AirLLMRuntimeDeps, 'fetchFn' | 'sleep' | 'now'> = {
      fetchFn: async (_url: string, _opts: { method: string }, timeoutMs: number) => {
        fetchTimeouts.push(timeoutMs);
        healthyChecks += 1;
        if (healthyChecks === 1) {
          return { ok: true, json: async () => ({ status: 'ok', loaded: false }) };
        }
        if (healthyChecks === 2) {
          await pollGate;
          return { ok: true, json: async () => ({ status: 'ok', loaded: true }) };
        }
        return { ok: true, json: async () => ({ status: 'ok', loaded: true }) };
      },
      sleep: async () => {
        now += 1000;
      },
      now: () => now
    };

    const startServer = async () => {
      startCalls += 1;
    };

    const first = ensureAirLLMRunning({
      baseUrl: 'http://localhost:11435',
      autoStart: true,
      waitForHealthySeconds: 30,
      panel: createPanel(panelMessages),
      startServer
    }, state, deps);

    const second = ensureAirLLMRunning({
      baseUrl: 'http://localhost:11435',
      autoStart: true,
      waitForHealthySeconds: 30,
      panel: createPanel(panelMessages),
      startServer
    }, state, deps);

    releasePoll?.();
    const [firstReady, secondReady] = await Promise.all([first, second]);

    expect(firstReady).to.equal(true);
    expect(secondReady).to.equal(true);
    expect(startCalls).to.equal(1);
    expect(fetchTimeouts).to.deep.equal([1500, 1500, 2000]);
    expect(panelMessages).to.have.length(1);
    expect(state.startInProgress).to.equal(undefined);
  });

  it('skips duplicate start command within the debounce window and times out cleanly', async () => {
    const state: AirLLMStartupState = { lastStartAt: 1000 };
    let now = 2500;
    let startCalls = 0;
    const sleepDurations: number[] = [];

    const ready = await ensureAirLLMRunning({
      baseUrl: 'http://localhost:11435',
      autoStart: true,
      waitForHealthySeconds: 1,
      startServer: async () => {
        startCalls += 1;
      }
    }, state, {
      fetchFn: async () => ({ ok: true, json: async () => ({ status: 'ok', loaded: false }) }),
      sleep: async (ms: number) => {
        sleepDurations.push(ms);
        now += ms;
      },
      now: () => now
    });

    expect(ready).to.equal(false);
    expect(startCalls).to.equal(0);
    expect(sleepDurations).to.have.length(5);
    expect(state.lastStartAt).to.equal(1000);
    expect(state.startInProgress).to.equal(undefined);
  });
});