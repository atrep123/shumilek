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
  if (typeof timeoutSeconds !== 'number' || isNaN(timeoutSeconds) || timeoutSeconds <= 0) {
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
