const mock = require('mock-require');
const { vscodeMock } = require('./helpers/vscodeMockShared');
mock('vscode', vscodeMock);

import { expect } from 'chai';
import {
  quoteForPowerShell,
  escapeForBashDoubleQuotes,
  toWslPath,
  expandAirllmCommandTemplate,
  buildAirLLMStartCommand,
  readAirLLMConfig,
  isAirLLMHealthy,
  AirLLMConfig
} from '../src/airllm';

function defaultCfg(overrides: Partial<AirLLMConfig> = {}): AirLLMConfig {
  return {
    serverUrl: 'http://localhost:11435',
    model: 'Qwen/Qwen2.5-72B-Instruct',
    compression: 'none',
    dtype: 'auto',
    cacheDir: '',
    useKvCache: false,
    runInWsl: false,
    wslDistro: 'Ubuntu',
    wslUser: '',
    startCommand: '',
    ...overrides
  };
}

describe('airllm', () => {

  // ── quoteForPowerShell ─────────────────────────────────────
  describe('quoteForPowerShell', () => {
    it('wraps value in single quotes', () => {
      expect(quoteForPowerShell('hello')).to.equal("'hello'");
    });

    it('escapes embedded single quotes', () => {
      expect(quoteForPowerShell("it's")).to.equal("'it''s'");
    });

    it('handles empty string', () => {
      expect(quoteForPowerShell('')).to.equal("''");
    });

    it('escapes multiple single quotes', () => {
      expect(quoteForPowerShell("a'b'c")).to.equal("'a''b''c'");
    });
  });

  // ── escapeForBashDoubleQuotes ──────────────────────────────
  describe('escapeForBashDoubleQuotes', () => {
    it('escapes backslashes', () => {
      expect(escapeForBashDoubleQuotes('a\\b')).to.equal('a\\\\b');
    });

    it('escapes double quotes', () => {
      expect(escapeForBashDoubleQuotes('say "hi"')).to.equal('say \\"hi\\"');
    });

    it('escapes dollar signs', () => {
      expect(escapeForBashDoubleQuotes('$HOME')).to.equal('\\$HOME');
    });

    it('handles mixed characters', () => {
      const result = escapeForBashDoubleQuotes('path\\to\\"$file"');
      expect(result).to.include('\\\\');
      expect(result).to.include('\\"');
      expect(result).to.include('\\$');
    });
  });

  // ── toWslPath ──────────────────────────────────────────────
  describe('toWslPath', () => {
    it('converts Windows drive path to WSL mount path', () => {
      const result = toWslPath('C:\\Users\\test');
      expect(result).to.match(/^\/mnt\/c\/Users\/test/);
    });

    it('lowercases drive letter', () => {
      const result = toWslPath('D:\\data');
      expect(result).to.match(/^\/mnt\/d\//);
    });

    it('converts backslashes to forward slashes', () => {
      const result = toWslPath('C:\\a\\b\\c');
      expect(result).not.to.include('\\');
    });
  });

  // ── expandAirllmCommandTemplate ────────────────────────────
  describe('expandAirllmCommandTemplate', () => {
    it('replaces placeholders', () => {
      const result = expandAirllmCommandTemplate('python {script} --model {model}', {
        script: '/path/to/server.py',
        model: 'Qwen/Qwen2.5-72B'
      });
      expect(result).to.equal('python /path/to/server.py --model Qwen/Qwen2.5-72B');
    });

    it('replaces multiple occurrences of same key', () => {
      const result = expandAirllmCommandTemplate('{x}+{x}', { x: 'A' });
      expect(result).to.equal('A+A');
    });

    it('leaves unknown placeholders alone', () => {
      const result = expandAirllmCommandTemplate('{known} {unknown}', { known: 'ok' });
      expect(result).to.equal('ok {unknown}');
    });

    it('handles empty values', () => {
      const result = expandAirllmCommandTemplate('--flag {val}', { val: '' });
      expect(result).to.equal('--flag ');
    });
  });

  // ── readAirLLMConfig ───────────────────────────────────────
  describe('readAirLLMConfig', () => {
    it('reads all fields from config object', () => {
      const store: Record<string, any> = {
        'airllm.serverUrl': 'http://myhost:9999',
        'airllm.model': 'test-model',
        'airllm.compression': 'gptq',
        'airllm.dtype': 'float16',
        'airllm.cacheDir': '/tmp/cache',
        'airllm.useKvCache': true,
        'airllm.runInWsl': true,
        'airllm.wslDistro': 'Debian',
        'airllm.wslUser': 'root',
        'airllm.startCommand': 'custom {model}'
      };
      const cfg = { get<T>(key: string, fallback: T): T { return (store[key] ?? fallback) as T; } };
      const result = readAirLLMConfig(cfg);
      expect(result.serverUrl).to.equal('http://myhost:9999');
      expect(result.model).to.equal('test-model');
      expect(result.compression).to.equal('gptq');
      expect(result.dtype).to.equal('float16');
      expect(result.cacheDir).to.equal('/tmp/cache');
      expect(result.useKvCache).to.equal(true);
      expect(result.runInWsl).to.equal(true);
      expect(result.wslDistro).to.equal('Debian');
      expect(result.wslUser).to.equal('root');
      expect(result.startCommand).to.equal('custom {model}');
    });

    it('falls back to defaults for missing config', () => {
      const cfg = { get<T>(_key: string, fallback: T): T { return fallback; } };
      const result = readAirLLMConfig(cfg);
      expect(result.model).to.equal('Qwen/Qwen2.5-72B-Instruct');
      expect(result.compression).to.equal('none');
      expect(result.runInWsl).to.equal(false);
    });
  });

  // ── buildAirLLMStartCommand ────────────────────────────────
  describe('buildAirLLMStartCommand', () => {
    it('builds PowerShell command for local mode', () => {
      const { command, baseUrl } = buildAirLLMStartCommand('/scripts/server.py', defaultCfg());
      expect(baseUrl).to.equal('http://localhost:11435');
      expect(command).to.include('python');
      expect(command).to.include('server.py');
      expect(command).to.include('--model');
      expect(command).to.include('--preload');
    });

    it('includes KV cache flag when enabled', () => {
      const { command } = buildAirLLMStartCommand('/server.py', defaultCfg({ useKvCache: true }));
      expect(command).to.include('--kv-cache');
    });

    it('omits KV cache flag when disabled', () => {
      const { command } = buildAirLLMStartCommand('/server.py', defaultCfg({ useKvCache: false }));
      expect(command).not.to.include('--kv-cache');
    });

    it('uses custom command template when provided', () => {
      const { command } = buildAirLLMStartCommand('/server.py', defaultCfg({
        startCommand: 'docker run {model} --port {port}'
      }));
      expect(command).to.include('docker run');
      expect(command).to.include('Qwen/Qwen2.5-72B-Instruct');
      expect(command).to.include('11435');
    });

    it('builds WSL command when runInWsl is true', () => {
      const { command } = buildAirLLMStartCommand('C:\\ext\\scripts\\server.py', defaultCfg({
        runInWsl: true,
        wslDistro: 'Ubuntu-22.04'
      }));
      expect(command).to.include('wsl');
      expect(command).to.include('-d');
      expect(command).to.include('Ubuntu-22.04');
      expect(command).to.include('python3');
      expect(command).to.include('/mnt/');
    });

    it('includes WSL user when provided', () => {
      const { command } = buildAirLLMStartCommand('/server.py', defaultCfg({
        runInWsl: true,
        wslUser: 'myuser'
      }));
      expect(command).to.include('-u');
      expect(command).to.include('myuser');
    });

    it('sets HF_HOME env vars when cacheDir provided (local)', () => {
      const { command } = buildAirLLMStartCommand('/server.py', defaultCfg({
        cacheDir: 'D:\\models'
      }));
      expect(command).to.include('HF_HOME');
      expect(command).to.include('TRANSFORMERS_CACHE');
    });

    it('sets HF_HOME env vars when cacheDir provided (WSL with Windows path)', () => {
      const { command } = buildAirLLMStartCommand('C:\\server.py', defaultCfg({
        runInWsl: true,
        cacheDir: 'D:\\cache'
      }));
      expect(command).to.include('HF_HOME');
      expect(command).to.include('/mnt/d/');
    });
  });

  // ── isAirLLMHealthy ────────────────────────────────────────
  describe('isAirLLMHealthy', () => {
    it('returns true when health endpoint returns ok', async () => {
      const fetchFn = async () => ({ ok: true, json: async () => ({ status: 'ok' }) });
      expect(await isAirLLMHealthy('http://localhost:11435', 1000, fetchFn)).to.be.true;
    });

    it('returns false when health endpoint reports ok but model is not loaded yet', async () => {
      const fetchFn = async () => ({ ok: true, json: async () => ({ status: 'ok', loaded: false }) });
      expect(await isAirLLMHealthy('http://localhost:11435', 1000, fetchFn)).to.be.false;
    });

    it('returns true when health endpoint reports ok and model is loaded', async () => {
      const fetchFn = async () => ({ ok: true, json: async () => ({ status: 'ok', loaded: true }) });
      expect(await isAirLLMHealthy('http://localhost:11435', 1000, fetchFn)).to.be.true;
    });

    it('returns false when health status is not ok', async () => {
      const fetchFn = async () => ({ ok: true, json: async () => ({ status: 'loading' }) });
      expect(await isAirLLMHealthy('http://localhost:11435', 1000, fetchFn)).to.be.false;
    });

    it('returns false when fetch fails', async () => {
      const fetchFn = async () => { throw new Error('ECONNREFUSED'); };
      expect(await isAirLLMHealthy('http://localhost:11435', 1000, fetchFn as any)).to.be.false;
    });

    it('returns false when response is not OK', async () => {
      const fetchFn = async () => ({ ok: false, json: async () => ({}) });
      expect(await isAirLLMHealthy('http://localhost:11435', 1000, fetchFn)).to.be.false;
    });
  });
});
