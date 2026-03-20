import * as vscode from 'vscode';
import { DEFAULT_CONTEXT_PROVIDERS } from './contextProviders';
import {
  AutoApprovePolicy,
  ContextProviderName,
  ExecutionMode,
  ValidationPolicy
} from './types';

// ============================================================
// Server URL parsing
// ============================================================

export function parseServerUrl(raw: string | undefined, fallback: string): { baseUrl: string; host: string; port: number } {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  let candidate = trimmed || fallback;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `http://${candidate}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    parsed = new URL(fallback);
  }
  const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
  const baseUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
  return { baseUrl, host: parsed.hostname, port: Number.isNaN(port) ? 0 : port };
}

// ============================================================
// Timeout resolution
// ============================================================

export function resolveTimeoutMs(config: vscode.WorkspaceConfiguration): number {
  let timeoutSeconds = config.get<number>('timeout', 1200);
  if (typeof timeoutSeconds !== 'number' || Number.isNaN(timeoutSeconds) || timeoutSeconds <= 0) {
    timeoutSeconds = 1200;
  }
  timeoutSeconds = Math.min(Math.max(timeoutSeconds, 10), 3600);
  return timeoutSeconds * 1000;
}

export function resolveStepTimeoutMs(config: vscode.WorkspaceConfiguration, fallbackMs: number): number {
  let seconds = config.get<number>('stepTimeoutSec', Math.max(30, Math.floor(fallbackMs / 1000)));
  if (typeof seconds !== 'number' || Number.isNaN(seconds) || seconds <= 0) {
    seconds = Math.max(30, Math.floor(fallbackMs / 1000));
  }
  seconds = Math.min(Math.max(seconds, 15), 3600);
  return Math.floor(seconds * 1000);
}

// ============================================================
// Validation & execution mode
// ============================================================

export function getValidationPolicy(config: vscode.WorkspaceConfiguration): ValidationPolicy {
  const raw = config.get<string>('validationPolicy', 'fail-soft');
  return raw === 'fail-closed' ? 'fail-closed' : 'fail-soft';
}

export function getConfiguredExecutionMode(config: vscode.WorkspaceConfiguration): ExecutionMode {
  const raw = config.get<string>('executionMode', 'hybrid');
  if (raw === 'chat' || raw === 'editor' || raw === 'hybrid') return raw;
  return 'hybrid';
}

export interface ToolRequirements {
  requireToolCall: boolean;
  requireMutation: boolean;
}

export type ResolvedExecutionMode = 'chat' | 'editor';

export function resolveExecutionMode(mode: ExecutionMode, requirements: ToolRequirements): ResolvedExecutionMode {
  if (mode === 'chat') return 'chat';
  if (mode === 'editor') return 'editor';
  return requirements.requireMutation ? 'editor' : 'chat';
}

// ============================================================
// Auto-approve & context providers
// ============================================================

export function getAutoApprovePolicy(config: vscode.WorkspaceConfiguration): AutoApprovePolicy {
  const raw = config.get<Record<string, unknown>>('autoApprove', {});
  return {
    read: Boolean(raw?.read ?? true),
    edit: Boolean(raw?.edit ?? false),
    commands: Boolean(raw?.commands ?? false),
    browser: Boolean(raw?.browser ?? false),
    mcp: Boolean(raw?.mcp ?? false)
  };
}

export function getContextProviders(config: vscode.WorkspaceConfiguration): ContextProviderName[] {
  const raw = config.get<string[]>('contextProviders', DEFAULT_CONTEXT_PROVIDERS);
  const allowed = new Set<ContextProviderName>(DEFAULT_CONTEXT_PROVIDERS);
  const out: ContextProviderName[] = [];
  for (const value of raw || []) {
    if (allowed.has(value as ContextProviderName)) out.push(value as ContextProviderName);
  }
  return out.length > 0 ? out : DEFAULT_CONTEXT_PROVIDERS.slice();
}

export function getContextProviderTokenBudget(config: vscode.WorkspaceConfiguration): number {
  const value = config.get<number>('contextProviderTokenBudget', 1500);
  if (typeof value !== 'number' || Number.isNaN(value)) return 1500;
  return Math.min(Math.max(Math.floor(value), 256), 8192);
}

// ============================================================
// Model presets
// ============================================================

export type ModelPresetConfig = {
  model: string;
  writerModel: string;
  rozumModel: string;
  miniModel: string;
  summarizerModel: string;
  brainModels: string[];
};

export const MODEL_PRESETS: Record<string, ModelPresetConfig> = {
  fast: {
    model: 'qwen2.5-coder:7b',
    writerModel: 'qwen2.5-coder:7b',
    rozumModel: 'qwen2.5:7b',
    miniModel: 'qwen2.5:3b',
    summarizerModel: 'qwen2.5:3b',
    brainModels: ['qwen2.5-coder:7b']
  },
  balanced: {
    model: 'qwen2.5-coder:7b',
    writerModel: 'deepseek-coder-v2:16b',
    rozumModel: 'deepseek-r1:8b',
    miniModel: 'qwen2.5:3b',
    summarizerModel: 'qwen2.5:3b',
    brainModels: ['qwen2.5-coder:7b', 'deepseek-coder-v2:16b']
  },
  quality: {
    model: 'deepseek-coder-v2:16b',
    writerModel: 'deepseek-coder-v2:16b',
    rozumModel: 'deepseek-r1:8b',
    miniModel: 'qwen2.5:3b',
    summarizerModel: 'qwen2.5:3b',
    brainModels: ['deepseek-coder-v2:16b', 'qwen2.5-coder:7b']
  }
};

export function resolveModelPreset(name: string | undefined): ModelPresetConfig | undefined {
  if (!name) return undefined;
  return MODEL_PRESETS[name];
}

// ============================================================
// Numeric clamping
// ============================================================

export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

// ============================================================
// Token & output limits
// ============================================================

export const DEFAULT_CONTEXT_TOKENS = 8192;
export const MIN_CONTEXT_TOKENS = 2048;
export const MAX_CONTEXT_TOKENS = 8192;
export const DEFAULT_AIRLLM_MAX_OUTPUT_TOKENS = 256;
export const MIN_AIRLLM_MAX_OUTPUT_TOKENS = 16;

export function getContextTokens(): number {
  const config = vscode.workspace.getConfiguration('shumilek');
  let tokens = config.get<number>('contextTokens', DEFAULT_CONTEXT_TOKENS);
  if (typeof tokens !== 'number' || Number.isNaN(tokens)) {
    tokens = DEFAULT_CONTEXT_TOKENS;
  }
  return clampNumber(tokens, DEFAULT_CONTEXT_TOKENS, MIN_CONTEXT_TOKENS, MAX_CONTEXT_TOKENS);
}

export function getMaxOutputTokens(fallback: number): number {
  const config = vscode.workspace.getConfiguration('shumilek');
  const backendType = config.get<string>('backendType', 'ollama');
  if (backendType !== 'airllm') return fallback;
  let tokens = config.get<number>('airllm.maxOutputTokens', DEFAULT_AIRLLM_MAX_OUTPUT_TOKENS);
  if (typeof tokens !== 'number' || Number.isNaN(tokens)) {
    tokens = DEFAULT_AIRLLM_MAX_OUTPUT_TOKENS;
  }
  return clampNumber(tokens, DEFAULT_AIRLLM_MAX_OUTPUT_TOKENS, MIN_AIRLLM_MAX_OUTPUT_TOKENS, fallback);
}

// ============================================================
// Tool settings
// ============================================================

export function getToolsEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('shumilek').get<boolean>('toolsEnabled', true);
}

export function getSafeModeSetting(): boolean {
  return vscode.workspace.getConfiguration('shumilek').get<boolean>('toolsConfirmEdits', false);
}

export function getToolsAutoOpenAutoSaveSetting(): boolean {
  return vscode.workspace.getConfiguration('shumilek').get<boolean>('toolsAutoOpenAutoSave', true);
}

export function getToolsAutoOpenOnWriteSetting(): boolean {
  return vscode.workspace.getConfiguration('shumilek').get<boolean>('toolsAutoOpenOnWrite', false);
}

export function getToolsWriteToastSetting(): boolean {
  return vscode.workspace.getConfiguration('shumilek').get<boolean>('toolsWriteToast', false);
}

export async function toggleToolsEnabledSetting(): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('shumilek');
  const current = config.get<boolean>('toolsEnabled', true);
  const target = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  const nextValue = !current;
  await config.update('toolsEnabled', nextValue, target);
  return nextValue;
}

export async function toggleSafeModeSetting(): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('shumilek');
  const current = config.get<boolean>('toolsConfirmEdits', false);
  const target = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  const nextValue = !current;
  await config.update('toolsConfirmEdits', nextValue, target);
  return nextValue;
}

// ============================================================
// ChatConfig: resolved config for handleChatInternal
// ============================================================

export interface ChatConfig {
  baseModel: string;
  writerModel: string;
  brainModels: string[];
  miniModel: string;
  rozumModel: string;
  summarizerModel: string;
  baseUrl: string;
  systemPrompt: string;
  timeout: number;
  maxRetries: number;
  pipelineAlwaysOn: boolean;
  useAirLLM: boolean;
  airllmAutoStart: boolean;
  airllmWaitForHealthy: number;
  guardianEnabled: boolean;
  miniModelEnabled: boolean;
  configuredExecutionMode: ExecutionMode;
  validationPolicy: ValidationPolicy;
  autoApprovePolicy: AutoApprovePolicy;
  maxAutoSteps: number;
  contextProviderNames: ContextProviderName[];
  contextProviderTokenBudget: number;
  stepTimeout: number;
  toolsEnabled: boolean;
  toolsConfirmEdits: boolean;
  toolsMaxIterations: number;
  effectiveAutoSteps: number;
  workspaceIndexEnabled: boolean;
  validatorLogsEnabled: boolean;
  summarizerEnabled: boolean;
  rewardEnabled: boolean;
  rewardEndpoint: string;
  rewardThreshold: number;
  hhemEnabled: boolean;
  hhemEndpoint: string;
  hhemThreshold: number;
  ragasEnabled: boolean;
  ragasEndpoint: string;
  ragasThreshold: number;
  modelPreset: string;
}

export function resolveChatConfig(config: vscode.WorkspaceConfiguration): ChatConfig {
  const modelPreset = config.get<string>('modelPreset', 'custom');
  const preset = resolveModelPreset(modelPreset);
  let baseModel = config.get<string>('model', preset?.model ?? 'deepseek-coder-v2:16b');
  let writerModel = config.get<string>('writerModel', preset?.writerModel ?? baseModel);
  let brainModels = config.get<string[]>('brainModels', preset?.brainModels ?? []);
  const pipelineAlwaysOn = config.get<boolean>('pipelineAlwaysOn', true);
  const backendType = config.get<string>('backendType', 'ollama');
  const useAirLLM = backendType === 'airllm';
  const airllmServerUrl = config.get<string>('airllm.serverUrl', 'http://localhost:11435');
  const airllmModel = config.get<string>('airllm.model', 'Qwen/Qwen2.5-72B-Instruct');
  const airllmAutoStart = config.get<boolean>('airllm.autoStart', false);
  const airllmWaitForHealthy = config.get<number>('airllm.waitForHealthySeconds', 30);
  let rawBaseUrl = useAirLLM ? airllmServerUrl : config.get<string>('baseUrl', 'http://localhost:11434');
  const baseUrlInfo = parseServerUrl(rawBaseUrl, useAirLLM ? 'http://localhost:11435' : 'http://localhost:11434');
  const baseUrl = baseUrlInfo.baseUrl;

  const systemPrompt = config.get<string>('systemPrompt', 'Jsi pomocný asistent pro programování. Odpovídej stručně a přesně. Používej český jazyk. NIKDY neopakuj stejné věty.');

  const timeout = resolveTimeoutMs(config);

  let maxRetries = config.get<number>('maxRetries', 2);
  if (typeof maxRetries !== 'number' || Number.isNaN(maxRetries) || maxRetries < 0) {
    maxRetries = 2;
  }
  maxRetries = Math.min(maxRetries, 5);

  const guardianEnabled = config.get<boolean>('guardianEnabled', true);
  const miniModelEnabled = config.get<boolean>('miniModelEnabled', true);
  let miniModel = config.get<string>('miniModel', preset?.miniModel ?? 'qwen2.5:3b');
  let rozumModel = config.get<string>('rozumModel', preset?.rozumModel ?? 'deepseek-r1:8b');
  const configuredExecutionMode = getConfiguredExecutionMode(config);
  const validationPolicy = getValidationPolicy(config);
  const autoApprovePolicy = getAutoApprovePolicy(config);
  const maxAutoSteps = clampNumber(config.get<number>('maxAutoSteps', 4), 4, 1, 20);
  const contextProviderNames = getContextProviders(config);
  const contextProviderTokenBudget = getContextProviderTokenBudget(config);
  const stepTimeout = resolveStepTimeoutMs(config, timeout);
  const toolsEnabled = config.get<boolean>('toolsEnabled', true);
  const toolsConfirmEdits = config.get<boolean>('toolsConfirmEdits', false);
  const toolsMaxIterations = config.get<number>('toolsMaxIterations', 6);
  const effectiveAutoSteps = Math.min(Math.max(1, toolsMaxIterations), maxAutoSteps);
  const workspaceIndexEnabled = config.get<boolean>('workspaceIndexEnabled', true);
  const validatorLogsEnabled = config.get<boolean>('validatorLogsEnabled', true);
  const rewardEnabled = config.get<boolean>('rewardEnabled', true);
  const rewardEndpoint = config.get<string>('rewardEndpoint', '');
  const rewardThreshold = config.get<number>('rewardThreshold', 0.7);
  const hhemEnabled = config.get<boolean>('hhemEnabled', true);
  const hhemEndpoint = config.get<string>('hhemEndpoint', '');
  const hhemThreshold = config.get<number>('hhemThreshold', 0.5);
  const ragasEnabled = config.get<boolean>('ragasEnabled', true);
  const ragasEndpoint = config.get<string>('ragasEndpoint', '');
  const ragasThreshold = config.get<number>('ragasThreshold', 0.75);
  const summarizerEnabled = config.get<boolean>('summarizerEnabled', true);
  let summarizerModel = config.get<string>('summarizerModel', preset?.summarizerModel ?? 'qwen2.5:3b');

  if (preset) {
    baseModel = preset.model;
    writerModel = preset.writerModel || preset.model;
    rozumModel = preset.rozumModel;
    miniModel = preset.miniModel;
    summarizerModel = preset.summarizerModel || preset.miniModel || preset.model;
    brainModels = preset.brainModels.slice();
  }
  if (useAirLLM) {
    const resolvedAirModel = (airllmModel || '').trim();
    if (resolvedAirModel) {
      baseModel = resolvedAirModel;
    }
    writerModel = baseModel;
    rozumModel = baseModel;
    miniModel = baseModel;
    summarizerModel = baseModel;
    brainModels = [baseModel];
  }
  if (!writerModel) writerModel = baseModel;
  if (!brainModels || brainModels.length === 0) brainModels = [baseModel];
  if (!summarizerModel || summarizerModel === 'pegasus-large') {
    summarizerModel = baseModel;
  }

  return {
    baseModel, writerModel, brainModels, miniModel, rozumModel, summarizerModel,
    baseUrl, systemPrompt, timeout, maxRetries, pipelineAlwaysOn, useAirLLM,
    airllmAutoStart, airllmWaitForHealthy, guardianEnabled, miniModelEnabled,
    configuredExecutionMode, validationPolicy, autoApprovePolicy, maxAutoSteps,
    contextProviderNames, contextProviderTokenBudget, stepTimeout, toolsEnabled,
    toolsConfirmEdits, toolsMaxIterations, effectiveAutoSteps, workspaceIndexEnabled,
    validatorLogsEnabled, summarizerEnabled, rewardEnabled, rewardEndpoint,
    rewardThreshold, hhemEnabled, hhemEndpoint, hhemThreshold, ragasEnabled,
    ragasEndpoint, ragasThreshold, modelPreset
  };
}
