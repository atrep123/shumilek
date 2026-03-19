/**
 * AirLLM server management — command building, health checks, and lifecycle.
 * Extracted from extension.ts for testability and separation of concerns.
 */
import * as path from 'path';
import { parseServerUrl } from './configResolver';

// ── Pure helpers ────────────────────────────────────────────────

export function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function escapeForBashDoubleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
}

export function toWslPath(winPath: string): string {
  // Normalize Windows-style input deterministically even when tests run on Linux.
  const resolved = path.win32.resolve(winPath);
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(resolved);
  if (!match) {
    return resolved.replace(/\\/g, '/');
  }
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, '/');
  return `/mnt/${drive}/${rest}`;
}

export function expandAirllmCommandTemplate(template: string, values: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return output;
}

// ── Config reader interface (decouples from vscode.WorkspaceConfiguration) ──

export interface AirLLMConfig {
  serverUrl: string;
  model: string;
  compression: string;
  dtype: string;
  cacheDir: string;
  useKvCache: boolean;
  runInWsl: boolean;
  wslDistro: string;
  wslUser: string;
  startCommand: string;
}

export function readAirLLMConfig(cfg: { get<T>(key: string, fallback: T): T }): AirLLMConfig {
  return {
    serverUrl: cfg.get<string>('airllm.serverUrl', 'http://localhost:11435'),
    model: (cfg.get<string>('airllm.model', 'Qwen/Qwen2.5-72B-Instruct') || '').trim() || 'Qwen/Qwen2.5-72B-Instruct',
    compression: (cfg.get<string>('airllm.compression', 'none') || '').trim() || 'none',
    dtype: (cfg.get<string>('airllm.dtype', 'auto') || '').trim() || 'auto',
    cacheDir: (cfg.get<string>('airllm.cacheDir', '') || '').trim(),
    useKvCache: cfg.get<boolean>('airllm.useKvCache', false),
    runInWsl: cfg.get<boolean>('airllm.runInWsl', false),
    wslDistro: (cfg.get<string>('airllm.wslDistro', 'Ubuntu') || '').trim(),
    wslUser: (cfg.get<string>('airllm.wslUser', '') || '').trim(),
    startCommand: (cfg.get<string>('airllm.startCommand', '') || '').trim()
  };
}

// ── Command builder ─────────────────────────────────────────────

export function buildAirLLMStartCommand(
  scriptPath: string,
  airCfg: AirLLMConfig
): { command: string; baseUrl: string } {
  const { baseUrl, host, port } = parseServerUrl(airCfg.serverUrl, 'http://localhost:11435');
  const kvCacheArg = airCfg.useKvCache ? '--kv-cache' : '';
  const kvCacheFlag = kvCacheArg ? ` ${kvCacheArg}` : '';

  const scriptArg = airCfg.runInWsl ? toWslPath(scriptPath) : scriptPath;
  const templateValues: Record<string, string> = {
    model: airCfg.model,
    compression: airCfg.compression,
    dtype: airCfg.dtype,
    host,
    port: String(port),
    script: scriptArg,
    cacheDir: airCfg.cacheDir,
    kvCacheArg,
    kvCacheFlag,
    useKvCache: airCfg.useKvCache ? 'true' : 'false'
  };

  if (airCfg.startCommand) {
    return { command: expandAirllmCommandTemplate(airCfg.startCommand, templateValues), baseUrl };
  }

  if (airCfg.runInWsl) {
    const cacheWsl = airCfg.cacheDir
      ? (airCfg.cacheDir.includes(':') || airCfg.cacheDir.startsWith('\\\\') ? toWslPath(airCfg.cacheDir) : airCfg.cacheDir)
      : '';
    const envPrefix = cacheWsl
      ? `export HF_HOME="${escapeForBashDoubleQuotes(cacheWsl)}"; export TRANSFORMERS_CACHE="${escapeForBashDoubleQuotes(cacheWsl)}"; export HUGGINGFACE_HUB_CACHE="${escapeForBashDoubleQuotes(cacheWsl)}"; `
      : '';
    const bashCmd = `${envPrefix}python3 "${escapeForBashDoubleQuotes(scriptArg)}" --model "${escapeForBashDoubleQuotes(airCfg.model)}" --compression "${escapeForBashDoubleQuotes(airCfg.compression)}" --dtype "${escapeForBashDoubleQuotes(airCfg.dtype)}" --host "${escapeForBashDoubleQuotes(host)}" --port ${port} --preload${kvCacheFlag}`;
    const bashArg = bashCmd.replace(/'/g, "''");
    const wslParts: string[] = ['wsl'];
    if (airCfg.wslDistro) wslParts.push('-d', airCfg.wslDistro);
    if (airCfg.wslUser) wslParts.push('-u', airCfg.wslUser);
    wslParts.push('--', 'bash', '-lc', `'${bashArg}'`);
    return { command: wslParts.join(' '), baseUrl };
  }

  const envPrefix = airCfg.cacheDir
    ? `$env:HF_HOME=${quoteForPowerShell(airCfg.cacheDir)}; $env:TRANSFORMERS_CACHE=${quoteForPowerShell(airCfg.cacheDir)}; $env:HUGGINGFACE_HUB_CACHE=${quoteForPowerShell(airCfg.cacheDir)}; `
    : '';
  const command = `${envPrefix}python ${quoteForPowerShell(scriptArg)} --model ${quoteForPowerShell(airCfg.model)} --compression ${quoteForPowerShell(airCfg.compression)} --dtype ${quoteForPowerShell(airCfg.dtype)} --host ${quoteForPowerShell(host)} --port ${port} --preload${kvCacheFlag}`;
  return { command, baseUrl };
}

// ── Health check (pure async, needs fetch injected) ─────────────

export async function isAirLLMHealthy(
  baseUrl: string,
  timeoutMs: number,
  fetchFn: (url: string, opts: { method: string }, timeout: number) => Promise<{ ok: boolean; json(): Promise<any> }>
): Promise<boolean> {
  try {
    const res = await fetchFn(`${baseUrl}/health`, { method: 'GET' }, timeoutMs);
    if (!res.ok) return false;
    const json = await res.json();
    if (json?.status !== 'ok') return false;
    if (typeof json?.loaded === 'boolean') {
      return json.loaded;
    }
    return true;
  } catch {
    return false;
  }
}
