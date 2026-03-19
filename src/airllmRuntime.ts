import * as path from 'path';
import { buildAirLLMStartCommand, isAirLLMHealthy as isAirLLMHealthyPure, readAirLLMConfig } from './airllm';
import { WebviewWrapper } from './types';

export interface AirLLMTerminalLike {
  show(preserveFocus?: boolean): void;
  sendText(text: string, addNewLine?: boolean): void;
}

export interface AirLLMStartupState {
  startInProgress?: Promise<boolean>;
  terminal?: AirLLMTerminalLike;
  lastStartAt?: number;
}

export interface AirLLMConfigReader {
  get<T>(key: string, fallback: T): T;
}

interface HealthResponse {
  ok: boolean;
  json(): Promise<any>;
}

export interface AirLLMRuntimeDeps {
  createTerminal(): AirLLMTerminalLike;
  fetchFn(url: string, opts: { method: string }, timeoutMs: number): Promise<HealthResponse>;
  sleep(ms: number): Promise<void>;
  now(): number;
  log?(message: string): void;
}

export interface EnsureAirLLMRunningOptions {
  baseUrl: string;
  autoStart: boolean;
  waitForHealthySeconds: number;
  panel?: WebviewWrapper;
  startServer(): Promise<void>;
}

const DEFAULT_WAIT_SECONDS = 30;
const MIN_WAIT_SECONDS = 5;
const MAX_WAIT_SECONDS = 300;
const START_DEBOUNCE_MS = 3000;

export function buildAirLLMStartCommandForExtension(
  extensionFsPath: string,
  config: AirLLMConfigReader
): { command: string; baseUrl: string } {
  const scriptPath = path.join(extensionFsPath, 'scripts', 'airllm_server.py');
  return buildAirLLMStartCommand(scriptPath, readAirLLMConfig(config));
}

export async function startAirLLMServer(
  extensionFsPath: string,
  config: AirLLMConfigReader,
  state: AirLLMStartupState,
  deps: Pick<AirLLMRuntimeDeps, 'createTerminal' | 'now' | 'log'>
): Promise<void> {
  const { command } = buildAirLLMStartCommandForExtension(extensionFsPath, config);
  if (!state.terminal) {
    state.terminal = deps.createTerminal();
  }
  state.terminal.show(false);
  state.terminal.sendText(command, true);
  state.lastStartAt = deps.now();
  deps.log?.(`[AirLLM] Start command: ${command}`);
}

export async function ensureAirLLMRunning(
  options: EnsureAirLLMRunningOptions,
  state: AirLLMStartupState,
  deps: Pick<AirLLMRuntimeDeps, 'fetchFn' | 'sleep' | 'now'>
): Promise<boolean> {
  const initialHealthy = await isAirLLMHealthyPure(options.baseUrl, 1500, deps.fetchFn);
  if (initialHealthy) return true;
  if (!options.autoStart) return false;

  if (state.startInProgress) {
    return state.startInProgress;
  }

  state.startInProgress = (async () => {
    const rawWait = typeof options.waitForHealthySeconds === 'number' && !Number.isNaN(options.waitForHealthySeconds)
      ? options.waitForHealthySeconds
      : DEFAULT_WAIT_SECONDS;
    const waitSeconds = Math.min(Math.max(rawWait, MIN_WAIT_SECONDS), MAX_WAIT_SECONDS);

    if (options.panel && options.panel.visible) {
      options.panel.webview.postMessage({
        type: 'pipelineStatus',
        icon: '🚀',
        text: 'Starting AirLLM server...',
        statusType: 'planning',
        loading: true
      });
    }

    if (!state.lastStartAt || deps.now() - state.lastStartAt > START_DEBOUNCE_MS) {
      await options.startServer();
    }

    const deadline = deps.now() + waitSeconds * 1000;
    while (deps.now() < deadline) {
      if (await isAirLLMHealthyPure(options.baseUrl, 2000, deps.fetchFn)) {
        return true;
      }
      await deps.sleep(1000);
    }

    return false;
  })();

  try {
    return await state.startInProgress;
  } finally {
    state.startInProgress = undefined;
  }
}