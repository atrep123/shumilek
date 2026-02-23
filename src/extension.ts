import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import fetch, { Headers, Response } from 'node-fetch';
import { 
  workspaceIndexer, 
  setWorkspaceLogger,
  WorkspaceIndex,
  ProjectMap
} from './workspace';
import { ContextProviderRegistry, DEFAULT_CONTEXT_PROVIDERS } from './contextProviders';
import { TurnOrchestrator } from './orchestration';
import { PIPELINE_STATUS_ICONS, PIPELINE_STATUS_TEXT } from './statusMessages';
import { getMiniUnavailableMessage, isMiniAccepted, shouldRetryMiniValidation } from './validationPolicy';
import { 
  Rozum, 
  setRozumLogger, 
  StepType, 
  ActionStep, 
  RozumPlan 
} from './rozum';
import { 
  ResponseGuardian, 
  setGuardianLogger, 
  setGuardianStats 
} from './guardian';
import { 
  HallucinationDetector, 
  setHallucinationLogger 
} from './hallucination';
import { 
  SvedomiValidator, 
  setSvedomiLogger, 
  setSvedomiStats, 
  setSvedomiTasks 
} from './svedomi';
import { 
  ChatMessage,
  ChatState,
  Task,
  GuardianResult,
  GuardianStats,
  HallucinationResult,
  MiniModelResult,
  QualityCheckResult,
  ResponseHistoryEntry,
  Conscience,
  AutoApprovePolicy,
  ContextProviderName,
  ExecutionMode,
  ValidationPolicy
} from './types';
// (Types imported from ./types)

// Webview message types
interface WebviewMessage {
  type: string;
  prompt?: string;
  text?: string;
  [key: string]: unknown;
}

// Fetch options type
interface FetchOptions {
  method?: string;
  headers?: Headers | Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

// External validator payload
interface ValidatorPayload {
  prompt: string;
  response: string;
  context?: string;
}

interface ToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

interface ToolResult {
  ok: boolean;
  tool: string;
  message?: string;
  data?: unknown;
  approved?: boolean;
}

interface ToolSessionState {
  hadMutations: boolean;
  mutationTools: string[];
  lastWritePath?: string;
  lastWriteAction?: 'created' | 'updated';
}

interface RangeInfo {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

interface ToolRequirements {
  requireToolCall: boolean;
  requireMutation: boolean;
}

interface ToolCallOptions {
  forceJson?: boolean;
  systemPromptOverride?: string;
  primaryModel?: string;
  fallbackModel?: string;
}

type ResolvedExecutionMode = 'chat' | 'editor';

interface VerificationCommandResult {
  command: string;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface VerificationSummary {
  ok: boolean;
  ran: VerificationCommandResult[];
  failed: VerificationCommandResult[];
}

// === Global State ===
let currentPanel: vscode.WebviewPanel | undefined;
let abortController: AbortController | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let toolsStatusBarItem: vscode.StatusBarItem | undefined;
let confirmStatusBarItem: vscode.StatusBarItem | undefined;
let projectMapUpdateTimer: NodeJS.Timeout | undefined;
let lastToolWritePath: string | undefined;
let lastToolWriteAction: 'created' | 'updated' | undefined;
let airllmStartInProgress: Promise<boolean> | undefined;
let airllmTerminal: vscode.Terminal | undefined;
let lastAirLLMStartAt: number | undefined;

function toAsciiLog(value: string): string {
  const input = String(value);
  const normalized = input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const asciiOnly = normalized.replace(/[^\x00-\x7F]/g, '');
  return asciiOnly;
}

function parseServerUrl(raw: string | undefined, fallback: string): { baseUrl: string; host: string; port: number } {
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

function resolveTimeoutMs(config: vscode.WorkspaceConfiguration): number {
  let timeoutSeconds = config.get<number>('timeout', 1200);
  if (typeof timeoutSeconds !== 'number' || isNaN(timeoutSeconds) || timeoutSeconds <= 0) {
    timeoutSeconds = 1200;
  }
  timeoutSeconds = Math.min(Math.max(timeoutSeconds, 10), 3600);
  return timeoutSeconds * 1000;
}

function resolveStepTimeoutMs(config: vscode.WorkspaceConfiguration, fallbackMs: number): number {
  let seconds = config.get<number>('stepTimeoutSec', Math.max(30, Math.floor(fallbackMs / 1000)));
  if (typeof seconds !== 'number' || Number.isNaN(seconds) || seconds <= 0) {
    seconds = Math.max(30, Math.floor(fallbackMs / 1000));
  }
  seconds = Math.min(Math.max(seconds, 15), 3600);
  return Math.floor(seconds * 1000);
}

function getValidationPolicy(config: vscode.WorkspaceConfiguration): ValidationPolicy {
  const raw = config.get<string>('validationPolicy', 'fail-soft');
  return raw === 'fail-closed' ? 'fail-closed' : 'fail-soft';
}

function getConfiguredExecutionMode(config: vscode.WorkspaceConfiguration): ExecutionMode {
  const raw = config.get<string>('executionMode', 'hybrid');
  if (raw === 'chat' || raw === 'editor' || raw === 'hybrid') return raw;
  return 'hybrid';
}

function resolveExecutionMode(mode: ExecutionMode, requirements: ToolRequirements): ResolvedExecutionMode {
  if (mode === 'chat') return 'chat';
  if (mode === 'editor') return 'editor';
  return requirements.requireMutation ? 'editor' : 'chat';
}

function getAutoApprovePolicy(config: vscode.WorkspaceConfiguration): AutoApprovePolicy {
  const raw = config.get<Record<string, unknown>>('autoApprove', {});
  return {
    read: Boolean(raw?.read ?? true),
    edit: Boolean(raw?.edit ?? false),
    commands: Boolean(raw?.commands ?? false),
    browser: Boolean(raw?.browser ?? false),
    mcp: Boolean(raw?.mcp ?? false)
  };
}

function getContextProviders(config: vscode.WorkspaceConfiguration): ContextProviderName[] {
  const raw = config.get<string[]>('contextProviders', DEFAULT_CONTEXT_PROVIDERS);
  const allowed = new Set<ContextProviderName>(DEFAULT_CONTEXT_PROVIDERS);
  const out: ContextProviderName[] = [];
  for (const value of raw || []) {
    if (allowed.has(value as ContextProviderName)) out.push(value as ContextProviderName);
  }
  return out.length > 0 ? out : DEFAULT_CONTEXT_PROVIDERS.slice();
}

function getContextProviderTokenBudget(config: vscode.WorkspaceConfiguration): number {
  const value = config.get<number>('contextProviderTokenBudget', 1500);
  if (typeof value !== 'number' || Number.isNaN(value)) return 1500;
  return Math.min(Math.max(Math.floor(value), 256), 8192);
}

async function runVerificationCommand(command: string, cwd: string, timeoutMs: number): Promise<VerificationCommandResult> {
  return await new Promise(resolve => {
    exec(command, { cwd, windowsHide: true, timeout: timeoutMs, env: process.env, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const exitCode = err ? (typeof (err as any).code === 'number' ? (err as any).code : null) : 0;
      resolve({
        command,
        ok: !err,
        exitCode,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? '')
      });
    });
  });
}

async function runPostEditVerification(timeoutMs: number): Promise<VerificationSummary> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return { ok: true, ran: [], failed: [] };
  }
  const root = folders[0].uri;
  const packageUri = vscode.Uri.joinPath(root, 'package.json');

  let scripts: Record<string, unknown> = {};
  try {
    const raw = await vscode.workspace.fs.readFile(packageUri);
    const pkg = JSON.parse(Buffer.from(raw).toString('utf8'));
    scripts = (pkg?.scripts && typeof pkg.scripts === 'object') ? pkg.scripts : {};
  } catch {
    return { ok: true, ran: [], failed: [] };
  }

  const commands: string[] = [];
  if (typeof scripts.lint === 'string') commands.push('npm run -s lint');
  if (typeof scripts.test === 'string') commands.push('npm run -s test');
  if (typeof scripts.build === 'string') commands.push('npm run -s build');
  if (commands.length === 0) return { ok: true, ran: [], failed: [] };

  const cwd = root.fsPath;
  const ran: VerificationCommandResult[] = [];
  for (const command of commands.slice(0, 3)) {
    const result = await runVerificationCommand(command, cwd, timeoutMs);
    ran.push(result);
    if (!result.ok) break;
  }
  const failed = ran.filter(r => !r.ok);
  return { ok: failed.length === 0, ran, failed };
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function escapeForBashDoubleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
}

function toWslPath(winPath: string): string {
  const resolved = path.resolve(winPath);
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(resolved);
  if (!match) {
    return resolved.replace(/\\/g, '/');
  }
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, '/');
  return `/mnt/${drive}/${rest}`;
}

function expandAirllmCommandTemplate(template: string, values: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return output;
}

function buildAirLLMStartCommand(
  context: vscode.ExtensionContext,
  config: vscode.WorkspaceConfiguration
): { command: string; baseUrl: string } {
  const serverUrl = config.get<string>('airllm.serverUrl', 'http://localhost:11435');
  const { baseUrl, host, port } = parseServerUrl(serverUrl, 'http://localhost:11435');
  const model = (config.get<string>('airllm.model', 'Qwen/Qwen2.5-72B-Instruct') || '').trim() || 'Qwen/Qwen2.5-72B-Instruct';
  const compression = (config.get<string>('airllm.compression', 'none') || '').trim() || 'none';
  const dtype = (config.get<string>('airllm.dtype', 'auto') || '').trim() || 'auto';
  const cacheDir = (config.get<string>('airllm.cacheDir', '') || '').trim();
  const useKvCache = config.get<boolean>('airllm.useKvCache', false);
  const runInWsl = config.get<boolean>('airllm.runInWsl', false);
  const wslDistro = (config.get<string>('airllm.wslDistro', 'Ubuntu') || '').trim();
  const wslUser = (config.get<string>('airllm.wslUser', '') || '').trim();
  const customCmd = (config.get<string>('airllm.startCommand', '') || '').trim();
  const kvCacheArg = useKvCache ? '--kv-cache' : '';
  const kvCacheFlag = kvCacheArg ? ` ${kvCacheArg}` : '';

  const scriptPath = path.join(context.extensionUri.fsPath, 'scripts', 'airllm_server.py');
  const scriptArg = runInWsl ? toWslPath(scriptPath) : scriptPath;
  const templateValues = {
    model,
    compression,
    dtype,
    host,
    port: String(port),
    script: scriptArg,
    cacheDir,
    kvCacheArg,
    kvCacheFlag,
    useKvCache: useKvCache ? 'true' : 'false'
  };

  if (customCmd) {
    return { command: expandAirllmCommandTemplate(customCmd, templateValues), baseUrl };
  }

  if (runInWsl) {
    const cacheWsl = cacheDir
      ? (cacheDir.includes(':') || cacheDir.startsWith('\\\\') ? toWslPath(cacheDir) : cacheDir)
      : '';
    const envPrefix = cacheWsl
      ? `export HF_HOME="${escapeForBashDoubleQuotes(cacheWsl)}"; export TRANSFORMERS_CACHE="${escapeForBashDoubleQuotes(cacheWsl)}"; export HUGGINGFACE_HUB_CACHE="${escapeForBashDoubleQuotes(cacheWsl)}"; `
      : '';
    const bashCmd = `${envPrefix}python3 "${escapeForBashDoubleQuotes(scriptArg)}" --model "${escapeForBashDoubleQuotes(model)}" --compression "${escapeForBashDoubleQuotes(compression)}" --dtype "${escapeForBashDoubleQuotes(dtype)}" --host "${escapeForBashDoubleQuotes(host)}" --port ${port} --preload${kvCacheFlag}`;
    const bashArg = bashCmd.replace(/'/g, "''");
    const wslParts: string[] = ['wsl'];
    if (wslDistro) wslParts.push('-d', wslDistro);
    if (wslUser) wslParts.push('-u', wslUser);
    wslParts.push('--', 'bash', '-lc', `'${bashArg}'`);
    return { command: wslParts.join(' '), baseUrl };
  }

  const envPrefix = cacheDir
    ? `$env:HF_HOME=${quoteForPowerShell(cacheDir)}; $env:TRANSFORMERS_CACHE=${quoteForPowerShell(cacheDir)}; $env:HUGGINGFACE_HUB_CACHE=${quoteForPowerShell(cacheDir)}; `
    : '';
  const command = `${envPrefix}python ${quoteForPowerShell(scriptArg)} --model ${quoteForPowerShell(model)} --compression ${quoteForPowerShell(compression)} --dtype ${quoteForPowerShell(dtype)} --host ${quoteForPowerShell(host)} --port ${port} --preload${kvCacheFlag}`;
  return { command, baseUrl };
}

async function startAirLLMServer(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('shumilek');
  const { command } = buildAirLLMStartCommand(context, config);
  if (!airllmTerminal) {
    airllmTerminal = vscode.window.createTerminal({ name: 'Shumilek AirLLM' });
  }
  airllmTerminal.show(false);
  airllmTerminal.sendText(command, true);
  lastAirLLMStartAt = Date.now();
  outputChannel?.appendLine(`[AirLLM] Start command: ${command}`);
}

async function isAirLLMHealthy(baseUrl: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${baseUrl}/health`, { method: 'GET' }, timeoutMs);
    if (!res.ok) return false;
    const json = await res.json();
    return json?.status === 'ok';
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureAirLLMRunning(
  context: vscode.ExtensionContext,
  baseUrl: string,
  autoStart: boolean,
  waitForHealthySeconds: number,
  panel?: WebviewWrapper
): Promise<boolean> {
  const initialHealthy = await isAirLLMHealthy(baseUrl, 1500);
  if (initialHealthy) return true;
  if (!autoStart) return false;

  if (airllmStartInProgress) {
    return airllmStartInProgress;
  }

  airllmStartInProgress = (async () => {
    const rawWait = typeof waitForHealthySeconds === 'number' && !Number.isNaN(waitForHealthySeconds)
      ? waitForHealthySeconds
      : 30;
    const waitSeconds = Math.min(Math.max(rawWait, 5), 300);
    if (panel && panel.visible) {
      panel.webview.postMessage({
        type: 'pipelineStatus',
        icon: '🚀',
        text: 'Starting AirLLM server...',
        statusType: 'planning',
        loading: true
      });
    }

    if (!lastAirLLMStartAt || Date.now() - lastAirLLMStartAt > 3000) {
      await startAirLLMServer(context);
    }

    const deadline = Date.now() + waitSeconds * 1000;
    while (Date.now() < deadline) {
      if (await isAirLLMHealthy(baseUrl, 2000)) {
        return true;
      }
      await sleep(1000);
    }
    return false;
  })();

  try {
    return await airllmStartInProgress;
  } finally {
    airllmStartInProgress = undefined;
  }
}
// Keep messages in module scope so we can safely refresh the webview HTML even
// when the panel already exists (retainContextWhenHidden=true), without breaking
// the message handler's reference.
let chatMessages: ChatMessage[] = [];
let guardianStats: GuardianStats = {
  totalChecks: 0,
  loopsDetected: 0,
  repetitionsFixed: 0,
  retriesTriggered: 0,
  miniModelValidations: 0,
  miniModelRejections: 0,
  hallucinationsDetected: 0,
  similarResponsesBlocked: 0
};

// Backup for clear/undo flow
let lastClearedMessages: ChatMessage[] | undefined;
let lastClearedAt: number | undefined;

// Response history for similarity detection
let responseHistory: ResponseHistoryEntry[] = [];
const MAX_HISTORY_SIZE = 20;
const lastReadHashes = new Map<string, { hash: string; updatedAt: number }>();

type ModelPresetConfig = {
  model: string;
  writerModel: string;
  rozumModel: string;
  miniModel: string;
  summarizerModel: string;
  brainModels: string[];
};

const MODEL_PRESETS: Record<string, ModelPresetConfig> = {
  fast: {
    model: 'qwen2.5-coder:7b',
    writerModel: 'qwen2.5-coder:7b',
    rozumModel: 'qwen2.5:7b',
    miniModel: 'qwen2.5:3b',
    summarizerModel: 'qwen2.5:3b',
    brainModels: ['qwen2.5-coder:7b', 'qwen2.5:7b']
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

function resolveModelPreset(name: string | undefined): ModelPresetConfig | undefined {
  if (!name) return undefined;
  return MODEL_PRESETS[name];
}

function getLastAssistantMessage(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'assistant') return m;
  }
  return undefined;
}

function extractPreferredFencedCodeBlock(text: string): { code: string; lang?: string } | null {
  const fenceRegex = /```([a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)```/g;
  const matches: Array<{ lang?: string; code: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(text)) !== null) {
    const lang = typeof match[1] === 'string' ? match[1].trim().toLowerCase() : undefined;
    const code = typeof match[2] === 'string' ? match[2] : '';
    if (code.trim().length > 0) matches.push({ lang, code });
  }
  if (matches.length === 0) return null;

  const preferred = ['ino', 'arduino', 'cpp', 'c', 'c++'];
  const best = matches.find(m => m.lang && preferred.includes(m.lang)) ?? matches[0];
  return { code: best.code.replace(/\r\n/g, '\n').trimEnd(), lang: best.lang };
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as any;
  const roleOk = v.role === 'system' || v.role === 'user' || v.role === 'assistant';
  const contentOk = typeof v.content === 'string';
  const timestampOk = v.timestamp === undefined || typeof v.timestamp === 'number';
  return roleOk && contentOk && timestampOk;
}

function sanitizeChatMessages(raw: unknown): ChatMessage[] {
  if (!raw || typeof raw !== 'object') return [];
  const maybeState = raw as any;
  const arr = Array.isArray(maybeState.messages) ? maybeState.messages : [];
  const sanitized = arr.filter(isChatMessage).map((m: ChatMessage) => ({
    role: m.role,
    content: m.content,
    timestamp: typeof m.timestamp === 'number' ? m.timestamp : undefined
  }));

  // Prevent UI/perf issues on very large histories.
  return sanitized.slice(-200);
}

function loadChatMessages(context: vscode.ExtensionContext): ChatMessage[] {
  try {
    const saved = context.workspaceState.get<ChatState>('chatState');
    const messages = sanitizeChatMessages(saved);
    if (saved && messages.length === 0) {
      // Previously persisted data is not usable; reset to keep webview stable.
      void context.workspaceState.update('chatState', { messages: [] });
    }
    return messages;
  } catch (e) {
    outputChannel?.appendLine(`[Init] Failed to load chatState: ${String(e)}`);
    void context.workspaceState.update('chatState', { messages: [] });
    return [];
  }
}

async function saveChatMessages(context: vscode.ExtensionContext, messages: ChatMessage[]): Promise<void> {
  try {
    await context.workspaceState.update('chatState', { messages });
  } catch (e) {
    outputChannel?.appendLine(`[State] Failed to save chatState: ${String(e)}`);
  }
}

function postToAllWebviews(message: WebviewMessage): void {
  try {
    currentPanel?.webview.postMessage(message);
  } catch {
    // ignore
  }
  try {
    sidebarView?.webview.postMessage(message);
  } catch {
    // ignore
  }
}

function formatQualityReport(results: QualityCheckResult[]): string {
  if (results.length === 0) return '';
  const lines = results.map(result => {
    const status = result.unavailable ? 'SKIPPED' : (result.ok ? 'PASS' : 'FAIL');
    const scoreText = typeof result.score === 'number'
      ? ` (skore ${result.score}${typeof result.threshold === 'number' ? ` / prah ${result.threshold}` : ''}${typeof result.rawScore === 'number' && result.rawScore !== result.score ? `, raw ${result.rawScore}` : ''})`
      : '';
    const details = result.details ? ` - ${result.details}` : '';
    return `- ${result.name}: ${status}${scoreText}${details}`;
  });
  return lines.join('\n');
}

function buildStructuredOutput(
  response: string,
  summary: string | null,
  checks: QualityCheckResult[],
  includeResponse: boolean = true
): string {
  const report = formatQualityReport(checks);
  let out = includeResponse ? `## Vysledek\n\n${response.trim()}` : response.trim();
  if (report) {
    out += `\n\n## Kontroly kvality\n${report}`;
  }
  if (summary && summary.trim()) {
    out += `\n\n## Strucne shrnuti\n${summary.trim()}`;
  }
  return out;
}

async function summarizeResponse(
  baseUrl: string,
  model: string,
  prompt: string,
  response: string,
  timeoutMs: number
): Promise<string | null> {
  if (!model) return null;
  try {
    const res = await fetchWithTimeout(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: 'Jsi shrnovač. Vrať krátké a věcné shrnutí v češtině (3–6 vět).' },
          { role: 'user', content: `Dotaz:\n${prompt}\n\nOdpověď:\n${response}` }
        ],
        options: {
          num_ctx: getContextTokens()
        }
      })
    }, timeoutMs);

    if (!res.ok) return null;
    const json = await res.json();
    const content = json?.message?.content;
    return typeof content === 'string' ? content.trim() : null;
  } catch (e) {
    outputChannel?.appendLine(`[Summarizer] Failed: ${String(e)}`);
    return null;
  }
}

function normalizeScore(value: unknown): number | undefined {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function normalizeExternalScore(
  score: number | undefined,
  threshold?: number
): { score?: number; rawScore?: number } {
  if (typeof score !== 'number') return { score };
  const rawScore = score;
  if (score > 1 && score <= 100 && (typeof threshold !== 'number' || threshold <= 1)) {
    return { score: score / 100, rawScore };
  }
  return { score, rawScore };
}

function pickBrainModel(prompt: string, candidates: string[], fallback: string): string {
  const normalized = prompt.toLowerCase();
  const prefersCode = /refaktor|bug|chyba|code|k[oó]d|test|typ|lint/.test(normalized);
  if (candidates.length === 0) return fallback;
  if (candidates.length === 1) return candidates[0];

  // Heuristic: prefer coder model for code-heavy tasks, otherwise first in list.
  if (prefersCode) {
    const match = candidates.find(m => m.toLowerCase().includes('coder')) ?? candidates[0];
    return match;
  }
  return candidates[0];
}

function getToolRequirements(prompt: string): { requireToolCall: boolean; requireMutation: boolean } {
  const normalized = prompt.toLowerCase();
  const requireMutation = /(vytvo[rř]|ulo[zž]|zapi[sš]|napi[sš]|uprav|upravit|přepi[sš]|prepis|přidej|pridej|sma[zž]|smaz|smazat|prejmenuj|přejmenuj|rename|delete|write|edit|modify|create|replace|patch|apply_patch|write_file|replace_lines)/.test(normalized);
  const requireToolCall = requireMutation || /(přečti|precti|zobraz|otevri|otevř|najdi|hledej|search|list_files|read_file|get_active_file|symboly|symbol|definice|definition|reference|references|diagnostik|diagnostics|lsp|get_symbols|get_workspace_symbols|get_definition|get_references|get_type_info|get_diagnostics)/.test(normalized);
  return { requireToolCall, requireMutation };
}

async function callExternalValidator(
  name: string,
  endpoint: string,
  payload: ValidatorPayload,
  timeoutMs: number,
  threshold?: number
): Promise<QualityCheckResult> {
  if (!endpoint) {
    return { name, ok: true, unavailable: true, details: 'Endpoint nenastaven' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeout);

    const text = await res.text();
    let score: number | undefined;
    let rawScore: number | undefined;
    let ok: boolean | undefined;
    let details: string | undefined;

    try {
      const json = JSON.parse(text);
      score = normalizeScore(json.score ?? json.value ?? json.result?.score);
      ok = typeof json.ok === 'boolean' ? json.ok : (typeof json.isFaithful === 'boolean' ? json.isFaithful : undefined);
      details = typeof json.reason === 'string' ? json.reason : (typeof json.detail === 'string' ? json.detail : undefined);
    } catch {
      score = normalizeScore((text.match(/score\s*[:=]\s*([0-9.]+)/i) || [])[1]);
      details = text.slice(0, 300).trim();
    }

    const normalized = normalizeExternalScore(score, threshold);
    score = normalized.score;
    rawScore = normalized.rawScore;

    const resolvedOk = typeof ok === 'boolean'
      ? ok
      : (typeof score === 'number' && typeof threshold === 'number'
        ? score >= threshold
        : true);

    return {
      name,
      ok: resolvedOk,
      score,
      rawScore,
      threshold,
      details
    };
  } catch (e) {
    return { name, ok: true, unavailable: true, details: `Validator error: ${String(e)}` };
  }
}

async function runExternalValidators(
  panel: WebviewWrapper | undefined,
  prompt: string,
  response: string,
  settings: {
    rewardEnabled: boolean;
    rewardEndpoint: string;
    rewardThreshold: number;
    hhemEnabled: boolean;
    hhemEndpoint: string;
    hhemThreshold: number;
    ragasEnabled: boolean;
    ragasEndpoint: string;
    ragasThreshold: number;
    timeoutMs: number;
  },
  logEnabled: boolean
): Promise<{
  rewardResult: QualityCheckResult;
  hhemResult: QualityCheckResult;
  ragasResult: QualityCheckResult;
  results: QualityCheckResult[];
}> {
  if (settings.rewardEnabled && settings.rewardEndpoint) {
    postToAllWebviews({ type: 'pipelineStatus', icon: '🏆', text: 'Reward model hodnoti odpoved...', statusType: 'validation', loading: true });
  }
  if (settings.hhemEnabled && settings.hhemEndpoint) {
    postToAllWebviews({ type: 'pipelineStatus', icon: '🧪', text: 'HHEM kontrola halucinaci...', statusType: 'validation', loading: true });
  }
  if (settings.ragasEnabled && settings.ragasEndpoint) {
    postToAllWebviews({ type: 'pipelineStatus', icon: '📏', text: 'RAGAS faithfulness...', statusType: 'validation', loading: true });
  }

  const rewardPromise = settings.rewardEnabled
    ? callExternalValidator(
        'Reward (OpenAssistant RM)',
        settings.rewardEndpoint,
        { prompt, response },
        settings.timeoutMs,
        settings.rewardThreshold
      )
    : Promise.resolve({ name: 'Reward (OpenAssistant RM)', ok: true, unavailable: true, details: 'Vypnuto' });

  const hhemPromise = settings.hhemEnabled
    ? callExternalValidator(
        'HHEM (Vectara)',
        settings.hhemEndpoint,
        { prompt, response },
        settings.timeoutMs,
        settings.hhemThreshold
      )
    : Promise.resolve({ name: 'HHEM (Vectara)', ok: true, unavailable: true, details: 'Vypnuto' });

  const ragasPromise = settings.ragasEnabled
    ? callExternalValidator(
        'RAGAS Faithfulness',
        settings.ragasEndpoint,
        { prompt, response },
        settings.timeoutMs,
        settings.ragasThreshold
      )
    : Promise.resolve({ name: 'RAGAS Faithfulness', ok: true, unavailable: true, details: 'Vypnuto' });

  const [rewardResult, hhemResult, ragasResult] = await Promise.all([
    rewardPromise,
    hhemPromise,
    ragasPromise
  ]);

  if (logEnabled) {
    const report = formatQualityReport([rewardResult, hhemResult, ragasResult]);
    if (report) {
      report.split('\n').forEach(line => {
        outputChannel?.appendLine(`[Validator] ${line}`);
      });
    }
  }

  return {
    rewardResult,
    hhemResult,
    ragasResult,
    results: [rewardResult, hhemResult, ragasResult]
  };
}

// ============================================================
// ROZUM - Reasoning/Planning Agent (deepseek-r1:8b)
// ============================================================

// (Types imported from ./rozum)



// Global Rozum instance
const rozum = new Rozum();

// ============================================================
// HALLUCINATION DETECTOR - System 1: Pattern-based detection
// ============================================================



// Global hallucination detector instance
const hallucinationDetector = new HallucinationDetector();

// ============================================================
// RESPONSE HISTORY - System for tracking similar responses
// ============================================================

class ResponseHistoryManager {
  private readonly SIMILARITY_THRESHOLD = 0.85;
  private readonly HASH_SAMPLE_SIZE = 300;

  /**
   * Add response to history
   */
  addResponse(response: string, prompt: string, score: number): void {
    const entry: ResponseHistoryEntry = {
      response: response.slice(0, 2000), // Store truncated for memory
      timestamp: Date.now(),
      promptHash: this.hashString(prompt),
      score
    };

    responseHistory.unshift(entry);
    
    // Trim history
    if (responseHistory.length > MAX_HISTORY_SIZE) {
      responseHistory = responseHistory.slice(0, MAX_HISTORY_SIZE);
    }

    outputChannel?.appendLine(`[ResponseHistory] 📝 Přidána odpověď (celkem: ${responseHistory.length})`);
  }

  /**
   * Check if response is too similar to recent responses
   */
  checkSimilarity(response: string, prompt: string): { isSimilar: boolean; matchedIndex: number; similarity: number } {
    const promptHash = this.hashString(prompt);
    
    for (let i = 0; i < responseHistory.length; i++) {
      const entry = responseHistory[i];
      
      // Skip if different prompt
      if (entry.promptHash !== promptHash) {
        continue;
      }

      const similarity = this.calculateJaccard(response, entry.response);
      
      if (similarity > this.SIMILARITY_THRESHOLD) {
        outputChannel?.appendLine(`[ResponseHistory] 🔄 Podobná odpověď nalezena (${(similarity * 100).toFixed(1)}%)`);
        guardianStats.similarResponsesBlocked++;
        return { isSimilar: true, matchedIndex: i, similarity };
      }
    }

    return { isSimilar: false, matchedIndex: -1, similarity: 0 };
  }

  /**
   * Get average score for prompt
   */
  getAverageScoreForPrompt(prompt: string): number | null {
    const promptHash = this.hashString(prompt);
    const matching = responseHistory.filter(e => e.promptHash === promptHash);
    
    if (matching.length === 0) return null;
    
    return matching.reduce((sum, e) => sum + e.score, 0) / matching.length;
  }

  /**
   * Clear history
   */
  clear(): void {
    responseHistory = [];
    outputChannel?.appendLine('[ResponseHistory] 🗑️ Historie vymazána');
  }

  /**
   * Simple string hash for comparison
   */
  private hashString(str: string): string {
    const sample = str.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, this.HASH_SAMPLE_SIZE);
    let hash = 0;
    for (let i = 0; i < sample.length; i++) {
      const char = sample.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * Jaccard similarity between two texts
   */
  private calculateJaccard(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    
    if (words1.size === 0 || words2.size === 0) return 0;

    let intersection = 0;
    for (const word of words1) {
      if (words2.has(word)) intersection++;
    }

    const union = words1.size + words2.size - intersection;
    return intersection / union;
  }

  /**
   * Get stats
   */
  getStats(): { total: number; avgScore: number } {
    const total = responseHistory.length;
    const avgScore = total > 0 
      ? responseHistory.reduce((sum, e) => sum + e.score, 0) / total 
      : 0;
    return { total, avgScore };
  }
}

// Global response history manager instance
const responseHistoryManager = new ResponseHistoryManager();

// ============================================================
// RESPONSE GUARDIAN - System 2: Quality control
// ============================================================



// Global guardian instance
const guardian = new ResponseGuardian();

// ============================================================
// MINI-MODEL VALIDATOR - AI-based quality check
// ============================================================



// svedomi je malý model, který kontroluje kvalitu odpovědí


// Global svedomi validator instance
const svedomi = new SvedomiValidator();
const contextProviders = new ContextProviderRegistry();

// Task database (persisted in VS Code state)
let tasksDatabase: Task[] = [];

// ============================================================
// GUARDIAN HELPERS
// ============================================================

/**
 * Log Guardian statistics to output channel
 */
function logGuardianStats(stats: GuardianStats): void {
  outputChannel?.appendLine(`[Guardian Stats] ${new Date().toISOString()}`);
  outputChannel?.appendLine(`  - Celkem kontrol: ${stats.totalChecks}`);
  outputChannel?.appendLine(`  - Detekované smyčky: ${stats.loopsDetected}`);
  outputChannel?.appendLine(`  - Opravená opakování: ${stats.repetitionsFixed}`);
  outputChannel?.appendLine(`  - Spuštěné opakování: ${stats.retriesTriggered}`);
  outputChannel?.appendLine(`  - Mini-model validací: ${stats.miniModelValidations}`);
  outputChannel?.appendLine(`  - Mini-model zamítnutí: ${stats.miniModelRejections}`);
}

/**
 * Send Guardian stats to webview dashboard
 */
function addGuardianStatsToWebview(webview: vscode.Webview, stats: GuardianStats): void {
  webview.postMessage({
    type: 'guardianStats',
    stats: {
      totalChecks: stats.totalChecks,
      loopsDetected: stats.loopsDetected,
      repetitionsFixed: stats.repetitionsFixed,
      retriesTriggered: stats.retriesTriggered,
      miniModelValidations: stats.miniModelValidations,
      miniModelRejections: stats.miniModelRejections
    }
  });
}

// ============================================================
// WEBVIEW VIEW PROVIDER (SIDEBAR)
// ============================================================

class ShumilekViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'shumilek.chatView';
  private _view?: vscode.WebviewView;
  private _context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: []
    };

    webviewView.webview.html = getWebviewContent(webviewView.webview, chatMessages);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      await this.handleMessage(msg);
    });

    // Update global reference
    sidebarView = webviewView;

    outputChannel?.appendLine('[Sidebar] View resolved');
  }

  private async handleMessage(msg: WebviewMessage) {
    if (!this._view) return;

    switch (msg.type) {
      case 'debugLog':
        outputChannel?.appendLine(`[Webview] ${String(msg.text ?? '')}`);
        break;

      case 'chat':
        if (msg.prompt) {
          await handleChatForView(this._view, this._context, msg.prompt, chatMessages);
        }
        break;

      case 'stop':
        if (abortController) {
          abortController.abort();
          abortController = undefined;
        }
        break;

      case 'requestActiveFile':
        const content = getActiveEditorContent();
        const fileName = getActiveFileName();
        this._view.webview.postMessage({
          type: 'activeFileContent',
          text: content,
          fileName
        });
        break;

      case 'clearHistory':
        lastClearedMessages = chatMessages.slice();
        lastClearedAt = Date.now();
        chatMessages.length = 0;
        guardian.resetHistory();
        await saveChatMessages(this._context, chatMessages);
        postToAllWebviews({ type: 'historyCleared' });
        break;

      case 'restoreHistory':
        if (lastClearedMessages && lastClearedMessages.length > 0) {
          if (lastClearedAt && (Date.now() - lastClearedAt) > 300000) {
            outputChannel?.appendLine('[Warning] Undo expired (>5 minutes)');
            postToAllWebviews({ type: 'historyRestoreFailed' });
            lastClearedMessages = undefined;
            lastClearedAt = undefined;
            break;
          }
          
          chatMessages.length = 0;
          chatMessages.push(...lastClearedMessages);
          try {
            await saveChatMessages(this._context, chatMessages);
            postToAllWebviews({ type: 'historyRestored', messages: chatMessages });
          } catch (err) {
            outputChannel?.appendLine(`[Error] Failed to restore history: ${String(err)}`);
            postToAllWebviews({ type: 'historyRestoreFailed' });
          }
          lastClearedMessages = undefined;
          lastClearedAt = undefined;
        } else {
          postToAllWebviews({ type: 'historyRestoreFailed' });
        }
        break;

      case 'getGuardianStats':
        this._view.webview.postMessage({ 
          type: 'guardianStats', 
          stats: guardian.getStats() 
        });
        break;
      case 'toggleSafeMode':
        try {
          const enabled = await toggleSafeModeSetting();
          postToAllWebviews({ type: 'safeModeUpdated', enabled });
        } catch (err) {
          outputChannel?.appendLine(`[Tools] Failed to toggle safe mode: ${String(err)}`);
          postToAllWebviews({ type: 'safeModeUpdated', enabled: getSafeModeSetting() });
        }
        break;
    }
  }

  public postMessage(message: WebviewMessage) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  public get view(): vscode.WebviewView | undefined {
    return this._view;
  }
}

// Global sidebar view reference
let sidebarView: vscode.WebviewView | undefined;
let sidebarProvider: ShumilekViewProvider | undefined;

// ============================================================
// EXTENSION ACTIVATION
// ============================================================

export function activate(context: vscode.ExtensionContext) {
  // Initialize output channel for logging
  outputChannel = vscode.window.createOutputChannel('Shumilek');
  context.subscriptions.push(outputChannel);
  const rawAppendLine = outputChannel.appendLine.bind(outputChannel);
  const rawAppend = outputChannel.append.bind(outputChannel);
  outputChannel.appendLine = (value: string) => {
    rawAppendLine(toAsciiLog(value));
  };
  outputChannel.append = (value: string) => {
    rawAppend(toAsciiLog(value));
  };
  outputChannel.appendLine('[Init] Shumilek activated');
  const config = vscode.workspace.getConfiguration('shumilek');
  const workspaceAutoScan = config.get<boolean>('workspaceAutoScan', false);
  const workspaceIndexEnabled = config.get<boolean>('workspaceIndexEnabled', true);
  toolsStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  confirmStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  context.subscriptions.push(toolsStatusBarItem, confirmStatusBarItem);
  updateToolsStatusBarItems();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (
      event.affectsConfiguration('shumilek.toolsEnabled') ||
      event.affectsConfiguration('shumilek.toolsConfirmEdits')
    ) {
      updateToolsStatusBarItems();
    }
    if (
      event.affectsConfiguration('shumilek.projectMapPath') ||
      event.affectsConfiguration('shumilek.projectMapCachePath') ||
      event.affectsConfiguration('shumilek.projectMapAutoUpdate')
    ) {
      scheduleProjectMapUpdate(context, 'config');
    }
    if (
      event.affectsConfiguration('shumilek.backendType') ||
      event.affectsConfiguration('shumilek.airllm')
    ) {
      const cfg = vscode.workspace.getConfiguration('shumilek');
      const backendType = cfg.get<string>('backendType', 'ollama');
      const autoStart = cfg.get<boolean>('airllm.autoStart', false);
      if (backendType === 'airllm' && autoStart) {
        const { baseUrl } = parseServerUrl(
          cfg.get<string>('airllm.serverUrl', 'http://localhost:11435'),
          'http://localhost:11435'
        );
        void ensureAirLLMRunning(context, baseUrl, true, cfg.get<number>('airllm.waitForHealthySeconds', 30));
      }
    }
  }));
  setRozumLogger(outputChannel);
  setGuardianLogger((msg: string) => outputChannel?.appendLine(msg));
  setGuardianStats(guardianStats);
  setHallucinationLogger((msg: string) => outputChannel?.appendLine(msg));
  setSvedomiLogger(outputChannel);
  setSvedomiStats(guardianStats);

  // Load persisted history (sanitize to prevent corrupted state from breaking the webview)
  chatMessages.length = 0;
  chatMessages.push(...loadChatMessages(context));
  outputChannel.appendLine(`[Init] Loaded ${chatMessages.length} message(s) from history`);

  // Register Sidebar View Provider
  sidebarProvider = new ShumilekViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ShumilekViewProvider.viewType,
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
  outputChannel.appendLine('[Init] Sidebar provider registered');

  context.subscriptions.push(vscode.window.onDidCloseTerminal(terminal => {
    if (terminal === airllmTerminal) {
      airllmTerminal = undefined;
    }
  }));

  const backendType = config.get<string>('backendType', 'ollama');
  const airllmAutoStart = config.get<boolean>('airllm.autoStart', false);
  if (backendType === 'airllm' && airllmAutoStart) {
    const { baseUrl } = parseServerUrl(
      config.get<string>('airllm.serverUrl', 'http://localhost:11435'),
      'http://localhost:11435'
    );
    void ensureAirLLMRunning(context, baseUrl, true, config.get<number>('airllm.waitForHealthySeconds', 30));
  }

  // Command: Open Chat (prefer sidebar, fallback to editor panel)
  const openChatCmd = vscode.commands.registerCommand('shumilek.openChat', async () => {
    outputChannel?.appendLine('[UI] openChat command invoked');
    // Make sure the user is looking at the right Output (especially in Extension Development Host)
    outputChannel?.show(true);

    // Prefer the sidebar view (activity bar container).
    try {
      await vscode.commands.executeCommand('workbench.view.extension.shumilek-sidebar');
      sidebarView?.show?.(true);
      if (sidebarView) return;
    } catch {
      // ignore and fallback to panel
    }

    if (currentPanel) {
      currentPanel.webview.html = getWebviewContent(currentPanel.webview, chatMessages);
      currentPanel.reveal(vscode.ViewColumn.One);
      return;
    }

    currentPanel = vscode.window.createWebviewPanel(
      'shumilekChat',
      'Shumilek Chat',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: []
      }
    );

    currentPanel.webview.html = getWebviewContent(currentPanel.webview, chatMessages);

    // Store message handler to prevent duplicates
    const messageHandler = async (msg: WebviewMessage) => {
      if (!currentPanel) return;

      switch (msg.type) {
        case 'debugLog':
          outputChannel?.appendLine(`[Webview] ${String(msg.text ?? '')}`);
          break;

        case 'chat':
          if (msg.prompt) {
            await handleChat(currentPanel, context, msg.prompt, chatMessages);
          }
          break;

        case 'stop':
          if (abortController) {
            abortController.abort();
            abortController = undefined;
          }
          break;

        case 'requestActiveFile':
          const content = getActiveEditorContent();
          const fileName = getActiveFileName();
          currentPanel.webview.postMessage({
            type: 'activeFileContent',
            text: content,
            fileName
          });
          break;

        case 'clearHistory':
          // Save backup for potential undo
          lastClearedMessages = chatMessages.slice();
          lastClearedAt = Date.now();

          chatMessages.length = 0;
          guardian.resetHistory();
          await saveChatMessages(context, chatMessages);
          postToAllWebviews({ type: 'historyCleared' });
          break;

        case 'restoreHistory':
          if (!currentPanel) break; // Panel may have been disposed
          if (lastClearedMessages && lastClearedMessages.length > 0) {
            // Check if undo is still valid (within 5 minutes)
            if (lastClearedAt && (Date.now() - lastClearedAt) > 300000) {
              outputChannel?.appendLine('[Warning] Undo expired (>5 minutes)');
              currentPanel.webview.postMessage({ type: 'historyRestoreFailed' });
              lastClearedMessages = undefined;
              lastClearedAt = undefined;
              break;
            }
            
            // Update array contents instead of reassigning const
            chatMessages.length = 0;
            chatMessages.push(...lastClearedMessages);
            try {
              await saveChatMessages(context, chatMessages);
              postToAllWebviews({ type: 'historyRestored', messages: chatMessages });
            } catch (err) {
              outputChannel?.appendLine(`[Error] Failed to restore history: ${String(err)}`);
              postToAllWebviews({ type: 'historyRestoreFailed' });
            }
            lastClearedMessages = undefined;
            lastClearedAt = undefined;
          } else {
            postToAllWebviews({ type: 'historyRestoreFailed' });
          }
          break;

        case 'getGuardianStats':
          if (currentPanel) {
            currentPanel.webview.postMessage({ 
              type: 'guardianStats', 
              stats: guardian.getStats() 
            });
          }
          break;
        case 'toggleSafeMode':
          try {
            const enabled = await toggleSafeModeSetting();
            postToAllWebviews({ type: 'safeModeUpdated', enabled });
          } catch (err) {
            outputChannel?.appendLine(`[Tools] Failed to toggle safe mode: ${String(err)}`);
            postToAllWebviews({ type: 'safeModeUpdated', enabled: getSafeModeSetting() });
          }
          break;
      }
    };

    // Subscribe to message handler
    const messageDisposable = currentPanel.webview.onDidReceiveMessage(messageHandler);

    currentPanel.onDidDispose(() => {
      messageDisposable.dispose();
      currentPanel = undefined;
      if (abortController) {
        abortController.abort();
        abortController = undefined;
      }
    });
  });

  const startAirLLMCmd = vscode.commands.registerCommand('shumilek.startAirLLM', async () => {
    try {
      await startAirLLMServer(context);
      vscode.window.showInformationMessage('AirLLM start command sent.');
    } catch (err) {
      outputChannel?.appendLine(`[AirLLM] Failed to start: ${String(err)}`);
      vscode.window.showErrorMessage('Failed to start AirLLM server.');
    }
  });

  const switchBackendCmd = vscode.commands.registerCommand('shumilek.switchBackend', async () => {
    const selection = await vscode.window.showQuickPick(
      [
        { label: 'Ollama', description: 'Local quantized models', value: 'ollama' },
        { label: 'AirLLM', description: 'AirLLM server (large models)', value: 'airllm' }
      ],
      { placeHolder: 'Select backend' }
    );
    if (!selection) return;

    const cfg = vscode.workspace.getConfiguration('shumilek');
    await cfg.update('backendType', selection.value, vscode.ConfigurationTarget.Workspace);
    outputChannel?.appendLine(`[Config] backendType set to ${selection.value}`);

    if (selection.value === 'airllm' && cfg.get<boolean>('airllm.autoStart', false)) {
      const { baseUrl } = parseServerUrl(
        cfg.get<string>('airllm.serverUrl', 'http://localhost:11435'),
        'http://localhost:11435'
      );
      void ensureAirLLMRunning(context, baseUrl, true, cfg.get<number>('airllm.waitForHealthySeconds', 30));
    }
  });

  // Command: Clear Chat History
  const clearHistoryCmd = vscode.commands.registerCommand('shumilek.clearHistory', async () => {
    // Backup existing persisted messages for undo
    const saved = context.workspaceState.get<ChatState>('chatState');
    lastClearedMessages = saved?.messages ? saved.messages.slice() : [];
    lastClearedAt = Date.now();

    await saveChatMessages(context, []);
    guardian.resetHistory();
    chatMessages.length = 0;
    postToAllWebviews({ type: 'historyCleared' });
    vscode.window.showInformationMessage('Šumílek: Historie byla vymazána');
  });

  // Command: Export last assistant response (prefer code block) to a file
  const exportLastResponseCmd = vscode.commands.registerCommand('shumilek.exportLastResponse', async () => {
    const lastAssistant = getLastAssistantMessage(chatMessages);
    const content = lastAssistant?.content ?? '';
    if (!content.trim()) {
      vscode.window.showWarningMessage('Šumílek: Není co exportovat (žádná poslední odpověď).');
      return;
    }

    const extracted = extractPreferredFencedCodeBlock(content);
    const suggestedText = (extracted?.code ?? content).trimEnd() + '\n';

    const format = await vscode.window.showQuickPick(
      [
        { label: 'Arduino (.ino)', ext: 'ino' },
        { label: 'Markdown (.md)', ext: 'md' },
        { label: 'Text (.txt)', ext: 'txt' }
      ],
      { placeHolder: 'Vyber formát exportu' }
    );
    if (!format) return;

    const dateStamp = new Date().toISOString().slice(0, 10);
    const defaultFileName = `shumilek-export-${dateStamp}.${format.ext}`;

    const baseFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultUri = baseFolder ? vscode.Uri.joinPath(baseFolder, defaultFileName) : undefined;

    const uri = await vscode.window.showSaveDialog({
      saveLabel: 'Uložit export',
      defaultUri,
      filters: {
        'Arduino sketch': ['ino'],
        'Markdown': ['md'],
        'Text': ['txt'],
        'All files': ['*']
      }
    });
    if (!uri) return;

    await vscode.workspace.fs.writeFile(uri, Buffer.from(suggestedText, 'utf8'));
    outputChannel?.appendLine(`[Export] Saved last response to: ${uri.fsPath}`);

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  });

  // Command: Apply last assistant response into the active editor
  const applyLastResponseCmd = vscode.commands.registerCommand('shumilek.applyLastResponseToEditor', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Šumílek: Není otevřený žádný editor.');
      return;
    }

    const lastAssistant = getLastAssistantMessage(chatMessages);
    const content = lastAssistant?.content ?? '';
    if (!content.trim()) {
      vscode.window.showWarningMessage('Šumílek: Není co vložit (žádná poslední odpověď).');
      return;
    }

    const extracted = extractPreferredFencedCodeBlock(content);
    const textToInsert = (extracted?.code ?? content).trimEnd() + '\n';

    await editor.edit(editBuilder => {
      const selection = editor.selection;
      if (!selection.isEmpty) {
        editBuilder.replace(selection, textToInsert);
      } else {
        editBuilder.insert(selection.active, textToInsert);
      }
    });

    outputChannel?.appendLine('[Apply] Last response inserted into active editor');
  });

  // Command: Show Guardian Stats
  const guardianStatsCmd = vscode.commands.registerCommand('shumilek.guardianStats', () => {
    const stats = guardian.getStats();
    logGuardianStats(stats);
    if (currentPanel) {
      addGuardianStatsToWebview(currentPanel.webview, stats);
    }
    if (sidebarView) {
      addGuardianStatsToWebview(sidebarView.webview, stats);
    }
    vscode.window.showInformationMessage(
      `🛡️ Guardian Stats\n\nKontrol: ${stats.totalChecks}\nSmyček: ${stats.loopsDetected}\nOpakování: ${stats.repetitionsFixed}\n\n🧠 svedomi\nValidací: ${stats.miniModelValidations}\nZamítnutí: ${stats.miniModelRejections}`
    );
  });

  // Command: Add new learning task
  const addTaskCmd = vscode.commands.registerCommand('shumilek.addTask', async () => {
    const title = await vscode.window.showInputBox({ 
      prompt: 'Název úkolu (např. "Hlídej chybějící kódy")',
      validateInput: (v) => v.trim().length < 3 ? 'Příliš krátký název' : null
    });
    if (!title) return;

    const description = await vscode.window.showInputBox({ 
      prompt: 'Popis problému (co má svedomi hlídat?)',
      validateInput: (v) => v.trim().length < 5 ? 'Příliš krátký popis' : null
    });
    if (!description) return;

    const categoryQuick = await vscode.window.showQuickPick(
      [
        { label: 'coding', description: 'Problémy v kódu' },
        { label: 'logic', description: 'Logické chyby' },
        { label: 'formatting', description: 'Formátování a styl' },
        { label: 'clarity', description: 'Srozumitelnost odpovědi' },
        { label: 'other', description: 'Ostatní' }
      ],
      { placeHolder: 'Kategorie úkolu' }
    );
    if (!categoryQuick) return;

    const weightStr = await vscode.window.showInputBox({
      prompt: 'Priorita (1-10, výchozí 5)',
      value: '5',
      validateInput: (v) => {
        const n = parseInt(v, 10);
        return isNaN(n) || n < 1 || n > 10 ? 'Zadej číslo 1-10' : null;
      }
    });
    const weight = weightStr ? Math.max(1, Math.min(10, parseInt(weightStr, 10))) : 5;

    // Generate unique ID with collision check
    let taskId: string;
    do {
      taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    } while (tasksDatabase.some(t => t.id === taskId));

    const newTask: Task = {
      id: taskId,
      title: title.trim(),
      description: description.trim(),
      category: categoryQuick.label as any,
      errorExamples: [],
      weight,
      lastChecked: Date.now()
    };

    tasksDatabase.push(newTask);
    await context.workspaceState.update('tasks', tasksDatabase);
    setSvedomiTasks(tasksDatabase);
    vscode.window.showInformationMessage(`✅ Úkol přidán: ${title} (priorita ${weight})`);
  });

  // Command: View all tasks
  const viewTasksCmd = vscode.commands.registerCommand('shumilek.viewTasks', async () => {
    if (tasksDatabase.length === 0) {
      vscode.window.showInformationMessage('📝 Žádné úkoly zatím. Přidej si nový příkazem "Šumílek: Přidat úkol"');
      return;
    }

    const taskItems = tasksDatabase.map((task, idx) => ({
      label: `${idx + 1}. ${task.title}`,
      description: `[${task.category}] ⭐${'★'.repeat(Math.min(10, Math.round(task.weight)))}`,
      detail: task.description,
      task
    }));

    const selected = await vscode.window.showQuickPick(taskItems, {
      placeHolder: 'Vyber úkol pro smazání nebo Esc pro návrat',
      canPickMany: false
    });

    if (selected) {
      const action = await vscode.window.showQuickPick(
        ['🗑️ Smazat', '✏️ Upravit prioritu', '❌ Zrušit'],
        { placeHolder: `Co chceš udělat s "${selected.task.title}"?` }
      );

      if (action === '🗑️ Smazat') {
        tasksDatabase = tasksDatabase.filter(t => t.id !== selected.task.id);
        await context.workspaceState.update('tasks', tasksDatabase);
    setSvedomiTasks(tasksDatabase);
        vscode.window.showInformationMessage(`✅ Úkol smazán: ${selected.task.title}`);
      } else if (action === '✏️ Upravit prioritu') {
        const newWeightStr = await vscode.window.showInputBox({
          prompt: 'Nová priorita (1 - 10)',
          value: String(selected.task.weight),
          validateInput: (v) => {
            const n = parseInt(v, 10);
            return isNaN(n) || n < 1 || n > 10 ? 'Zadej číslo 1-10' : null;
          }
        });
        if (newWeightStr) {
          const parsed = parseInt(newWeightStr, 10);
          const weight = isNaN(parsed) ? selected.task.weight : Math.max(1, Math.min(10, parsed));
          // Find and update the task in array
          const taskIndex = tasksDatabase.findIndex(t => t.id === selected.task.id);
          if (taskIndex !== -1) {
            tasksDatabase[taskIndex].weight = weight;
            await context.workspaceState.update('tasks', tasksDatabase);
    setSvedomiTasks(tasksDatabase);
            vscode.window.showInformationMessage(`✅ Priorita aktualizována: ${weight}`);
          }
        }
      }
    }
  });

  // Load tasks from persistent state
  const savedTasks = context.workspaceState.get<Task[]>('tasks');
  if (savedTasks && Array.isArray(savedTasks)) {
    tasksDatabase = savedTasks
      .filter(t => t && t.id && t.title) // Filter out corrupt entries
      .map(t => ({ 
        ...t, 
        weight: normalizeTaskWeight(t.weight),
        errorExamples: Array.isArray(t.errorExamples) ? t.errorExamples : []
      }));
  }
  setSvedomiTasks(tasksDatabase);

  // Workspace indexer commands
  setWorkspaceLogger(outputChannel);

  // Auto-scan workspace on extension load for deep work
  (async () => {
    try {
      const folders = vscode.workspace.workspaceFolders;
      if (workspaceIndexEnabled && workspaceAutoScan && folders && folders.length > 0) {
        outputChannel?.appendLine('[Šumílek] Auto-scanning workspace for deep analysis...');
        await workspaceIndexer.scanWorkspace((msg) => {
          outputChannel?.appendLine(`[WorkspaceIndexer] ${msg}`);
        });
        const index = workspaceIndexer.getIndex();
        if (index) {
          outputChannel?.appendLine(`[Šumílek] ✅ Ready: ${index.files.length} files, ${index.symbols.length} symbols indexed`);
          await ensureProjectMap(context, "auto-scan", undefined, true);
        }
      }
    } catch (err) {
      outputChannel?.appendLine(`[Šumílek] ⚠️ Auto-scan failed: ${String(err)}`);
    }
  })();

  const scanWorkspaceCmd = vscode.commands.registerCommand('shumilek.scanWorkspace', async () => {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Šumílek skenuje projekt...',
      cancellable: false
    }, async (progress) => {
      const index = await workspaceIndexer.scanWorkspace((msg) => {
        progress.report({ message: msg });
      });
      
      vscode.window.showInformationMessage(
        `✅ Projekt naskenován: ${index.files.length} souborů, ${index.symbols.length} symbolů`
      );
      
      // Show summary in output
      outputChannel?.appendLine('\n=== WORKSPACE SUMMARY ===');
      outputChannel?.appendLine(index.summary);
      outputChannel?.appendLine('\n=== STRUCTURE ===');
      outputChannel?.appendLine(index.structure);
      await ensureProjectMap(context, "manual-scan", undefined, true);
      outputChannel?.show();
    });
  });

  const showWorkspaceInfoCmd = vscode.commands.registerCommand('shumilek.showWorkspaceInfo', async () => {
    const index = workspaceIndexer.getIndex();
    
    if (!index) {
      const scan = await vscode.window.showInformationMessage(
        'Projekt není naskenován. Chcete ho naskenovat nyní?',
        'Ano', 'Ne'
      );
      if (scan === 'Ano') {
        await vscode.commands.executeCommand('shumilek.scanWorkspace');
      }
      return;
    }

    // Show quick pick with workspace info
    const items = [
      { label: '📊 Souhrn', description: index.summary },
      { label: '📁 Souborů', description: `${index.files.length}` },
      { label: '🔍 Symbolů', description: `${index.symbols.length}` },
      { label: '⏰ Poslední aktualizace', description: new Date(index.lastUpdated).toLocaleString('cs-CZ') }
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Šumílek - Info o projektu',
      placeHolder: 'Vyberte položku pro detail'
    });

    if (selected?.label === '📊 Souhrn') {
      outputChannel?.appendLine('\n=== WORKSPACE SUMMARY ===');
      outputChannel?.appendLine(index.summary);
      outputChannel?.appendLine('\n=== STRUCTURE ===');
      outputChannel?.appendLine(index.structure);
      outputChannel?.show();
    }
  });

  const toggleToolsEnabledCmd = vscode.commands.registerCommand('shumilek.toggleToolsEnabled', async () => {
    try {
      const enabled = await toggleToolsEnabledSetting();
      updateToolsStatusBarItems();
      outputChannel?.appendLine(`[Tools] toolsEnabled set to ${enabled}`);
    } catch (err) {
      outputChannel?.appendLine(`[Tools] Failed to toggle toolsEnabled: ${String(err)}`);
      updateToolsStatusBarItems();
    }
  });

  const toggleToolsConfirmEditsCmd = vscode.commands.registerCommand('shumilek.toggleToolsConfirmEdits', async () => {
    try {
      const enabled = await toggleSafeModeSetting();
      updateToolsStatusBarItems();
      postToAllWebviews({ type: 'safeModeUpdated', enabled });
      outputChannel?.appendLine(`[Tools] toolsConfirmEdits set to ${enabled}`);
    } catch (err) {
      outputChannel?.appendLine(`[Tools] Failed to toggle toolsConfirmEdits: ${String(err)}`);
      updateToolsStatusBarItems();
      postToAllWebviews({ type: 'safeModeUpdated', enabled: getSafeModeSetting() });
    }
  });

  const projectMapWatchers: vscode.Disposable[] = [];
  if (workspaceIndexEnabled) {
    projectMapWatchers.push(vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (!isWithinWorkspace(doc.uri)) return;
      await workspaceIndexer.updateFile(doc.uri);
      workspaceIndexer.markProjectMapDirty();
      scheduleProjectMapUpdate(context, 'save', doc.uri);
    }));
    projectMapWatchers.push(vscode.workspace.onDidCreateFiles(async (evt) => {
      for (const file of evt.files) {
        if (!isWithinWorkspace(file)) continue;
        await workspaceIndexer.updateFile(file);
      }
      workspaceIndexer.markProjectMapDirty();
      scheduleProjectMapUpdate(context, 'create', evt.files[0]);
    }));
    projectMapWatchers.push(vscode.workspace.onDidDeleteFiles((evt) => {
      for (const file of evt.files) {
        if (!isWithinWorkspace(file)) continue;
        workspaceIndexer.removeFile(file);
      }
      workspaceIndexer.markProjectMapDirty();
      scheduleProjectMapUpdate(context, 'delete', evt.files[0]);
    }));
    projectMapWatchers.push(vscode.workspace.onDidRenameFiles(async (evt) => {
      for (const file of evt.files) {
        if (isWithinWorkspace(file.oldUri)) {
          workspaceIndexer.removeFile(file.oldUri);
        }
        if (isWithinWorkspace(file.newUri)) {
          await workspaceIndexer.updateFile(file.newUri);
        }
      }
      workspaceIndexer.markProjectMapDirty();
      scheduleProjectMapUpdate(context, 'rename', evt.files[0]?.newUri);
    }));
  }

  context.subscriptions.push(
    openChatCmd, startAirLLMCmd, switchBackendCmd, clearHistoryCmd, guardianStatsCmd, addTaskCmd, viewTasksCmd,
    scanWorkspaceCmd, showWorkspaceInfoCmd, exportLastResponseCmd, applyLastResponseCmd,
    toggleToolsEnabledCmd, toggleToolsConfirmEditsCmd,
    ...projectMapWatchers
  );
}

export function deactivate() {
  if (abortController) {
    abortController.abort();
    abortController = undefined;
  }
  if (outputChannel) {
    outputChannel.dispose();
  }
}

// ============================================================
// CHAT HANDLER WITH GUARDIAN
// ============================================================

// Wrapper interface for both Panel and View
interface WebviewWrapper {
  webview: vscode.Webview;
  visible: boolean;
}

// Wrap WebviewPanel
function wrapPanel(panel: vscode.WebviewPanel): WebviewWrapper {
  return {
    webview: panel.webview,
    get visible() { return panel.visible; }
  };
}

// Wrap WebviewView  
function wrapView(view: vscode.WebviewView): WebviewWrapper {
  return {
    webview: view.webview,
    get visible() { return view.visible; }
  };
}

// Handle chat for WebviewView (sidebar)
async function handleChatForView(
  view: vscode.WebviewView,
  context: vscode.ExtensionContext,
  prompt: string,
  messages: ChatMessage[],
  retryCount: number = 0
): Promise<void> {
  return handleChatInternal(wrapView(view), context, prompt, messages, retryCount);
}

async function handleChat(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  prompt: string,
  messages: ChatMessage[],
  retryCount: number = 0
): Promise<void> {
  return handleChatInternal(wrapPanel(panel), context, prompt, messages, retryCount);
}

async function handleChatInternal(
  panel: WebviewWrapper,
  context: vscode.ExtensionContext,
  prompt: string,
  messages: ChatMessage[],
  retryCount: number = 0,
  retryFeedback?: string
): Promise<void> {
  const config = vscode.workspace.getConfiguration('shumilek');
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
  let baseUrl = useAirLLM ? airllmServerUrl : config.get<string>('baseUrl', 'http://localhost:11434');
  const baseUrlInfo = parseServerUrl(baseUrl, useAirLLM ? 'http://localhost:11435' : 'http://localhost:11434');
  baseUrl = baseUrlInfo.baseUrl;
  
  const systemPrompt = config.get<string>('systemPrompt', 'Jsi pomocný asistent pro programování. Odpovídej stručně a přesně. Používej český jazyk. NIKDY neopakuj stejné věty.');
  
  const timeout = resolveTimeoutMs(config);
  
  // Validate maxRetries
  let maxRetries = config.get<number>('maxRetries', 2);
  if (typeof maxRetries !== 'number' || isNaN(maxRetries) || maxRetries < 0) {
    maxRetries = 2;
  }
  maxRetries = Math.min(maxRetries, 5); // Max 5 retries
  
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
  const toolsEnabledSetting = config.get<boolean>('toolsEnabled', true);
  const toolsEnabled = toolsEnabledSetting;
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
  if (preset) {
    outputChannel?.appendLine(`[Models] Preset applied: ${modelPreset}`);
  }

  // Configure mini-model validator
  svedomi.configure(baseUrl, miniModel, miniModelEnabled);

  // Check if panel is still active
  if (!panel || panel.webview === undefined) {
    outputChannel?.appendLine('Shumilek Chat');
    return;
  }

  // Validate input
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    panel.webview.postMessage({ type: 'responseError', text: 'Prázdný dotaz' });
    return;
  }
  if (trimmedPrompt.length > 10000) {
    panel.webview.postMessage({ 
      type: 'responseError', 
      text: `Dotaz je příliš dlouhý (${trimmedPrompt.length} znaků, max 10000)` 
    });
    return;
  }

  // Only add user message on first attempt
  if (retryCount === 0) {
    messages.push({ role: 'user', content: trimmedPrompt, timestamp: Date.now() });
  }

  if (useAirLLM) {
    const ready = await ensureAirLLMRunning(context, baseUrl, airllmAutoStart, airllmWaitForHealthy, panel);
    if (!ready) {
      panel.webview.postMessage({
        type: 'responseError',
        text: 'AirLLM server is not ready. Start it and retry.'
      });
      return;
    }
  }

  const detectedToolRequirements = getToolRequirements(trimmedPrompt);
  const resolvedExecutionMode = resolveExecutionMode(configuredExecutionMode, detectedToolRequirements);
  const toolCallsEnabled = toolsEnabled && resolvedExecutionMode !== 'editor';
  const toolRequirements = toolCallsEnabled
    ? detectedToolRequirements
    : { requireToolCall: false, requireMutation: false };

  // Provider-based context assembly with explicit token budget.
  const providerContext = await contextProviders.collect({
    prompt: trimmedPrompt,
    enabled: contextProviderNames,
    tokenBudget: contextProviderTokenBudget,
    workspaceIndexEnabled
  });
  const workspaceContext = providerContext ? `\n\n${providerContext}` : '';

  // Enhanced system prompt with anti-loop instructions and workspace context
  const retryFeedbackSection = retryFeedback
    ? `

FEEDBACK Z VALIDACE (oprav chyby):
${retryFeedback.slice(0, 1000)}`
    : '';

  const enhancedSystemPrompt = systemPrompt + `
DŮLEŽITÉ INSTRUKCE:
- Nikdy neopakuj stejné věty nebo odstavce
- Pokud jsi odpověděl, nesměřuj k opakování
- Buď stručný a konkrétní
- Ukonči odpověď, když jsi hotov

PŘÍSTUP K PRÁCI:
- Postupuj METODICKY a DŮKLADNĚ
- Analyzuj KAŽDÝ relevantní soubor, ne jen první
- Pokud je potřeba zkontrolovat mnoho souborů, projdi je VŠECHNY
- Nespěchej - kvalita je důležitější než rychlost
- Pokud je vstup prilis dlouhy, zpracuj ho po blocich a prubezne shrnuj
- Dokumentuj své kroky a zjištění${retryFeedbackSection}${workspaceContext}`;

  let toolsModel = config.get<string>('toolsModel', '').trim();
  let toolsFallbackModel = config.get<string>('toolsFallbackModel', 'qwen2.5:14b-instruct').trim();
  if (useAirLLM) {
    toolsModel = baseModel;
    toolsFallbackModel = baseModel;
  }
  const toolPrimaryModel = toolsModel || writerModel;
  const toolOnlyPrompt = toolCallsEnabled ? buildToolOnlyPrompt(toolRequirements.requireMutation) : '';
  const toolRequirementNote = toolCallsEnabled && (toolRequirements.requireToolCall || toolRequirements.requireMutation)
    ? [
        'POVINNE POUZIT NASTROJE:',
        'Tento dotaz vyzaduje tool_call odpovedi. Nepis bezny text.',
        toolRequirements.requireMutation
          ? 'Musis zmenit soubor (write_file/replace_lines). Pouhe cteni nebo navrh bez zapisu je spatne.'
          : 'Musis pouzit aspon jeden tool_call.'
      ].join('\n')
    : '';
  const toolSystemPrompt = toolCallsEnabled
    ? `${enhancedSystemPrompt}\n\n${toolRequirementNote}\n\n${buildToolInstructions()}`
    : enhancedSystemPrompt;
  const toolPromptForMain = toolCallsEnabled && toolRequirements.requireToolCall
    ? toolOnlyPrompt
    : toolSystemPrompt;
  const toolSession: ToolSessionState = {
    hadMutations: false,
    mutationTools: [],
    lastWritePath: lastToolWritePath,
    lastWriteAction: lastToolWriteAction
  };
  const editorContext = resolvedExecutionMode === 'editor'
    ? await buildEditorContext(trimmedPrompt, context, workspaceIndexEnabled, getActiveWorkspaceFileUri())
    : '';
  const editorSystemPrompt = resolvedExecutionMode === 'editor'
    ? `${enhancedSystemPrompt}\n\n${buildEditorFirstInstructions()}\n\n${editorContext}`
    : toolSystemPrompt;

  // === ROZUM PRE-PLANNING ===
  let rozumPlan: RozumPlan | null = null;
  
  const rozumEnabledSetting = config.get<boolean>('rozumEnabled', true);
  const rozumEnabled = pipelineAlwaysOn ? true : rozumEnabledSetting;
  const selectedBrainModel = pickBrainModel(trimmedPrompt, brainModels, rozumModel);
  rozum.configure(baseUrl, selectedBrainModel, rozumEnabled, pipelineAlwaysOn);
  outputChannel?.appendLine(`[Rozum] Selected brain model: ${selectedBrainModel}`);

  // Rozum plánuje jen pro komplexní dotazy (ne pro pozdravy jako "ahoj")
  const needsPlan = rozum.shouldTriggerPlanning(trimmedPrompt);
  const shouldPlan = needsPlan && resolvedExecutionMode !== 'editor' && !(toolCallsEnabled && toolRequirements.requireToolCall);
  const orchestrator = new TurnOrchestrator({
    promptLength: trimmedPrompt.length,
    retryCount,
    mode: resolvedExecutionMode
  });
  if (!shouldPlan) {
    orchestrator.force('act', { reason: 'planning_skipped' });
  }
  outputChannel?.appendLine(`[Rozum] Enabled: ${rozumEnabled}, NeedsPlanning: ${needsPlan}, ToolRequired: ${toolCallsEnabled && toolRequirements.requireToolCall}, Mode=${resolvedExecutionMode}`);
  if (needsPlan && !shouldPlan) {
    outputChannel?.appendLine('[Rozum] Preskakuji planovani (editor mode nebo povinne nastroje)');
  }

  // Show what systems are active in chat
  if (panel && panel.visible) {
    const systems: string[] = [];
    if (useAirLLM) systems.push('AirLLM');
    if (shouldPlan) systems.push('Rozum');
    if (miniModelEnabled) systems.push('svedomi');
    if (guardianEnabled) systems.push('Guardian');
    if (toolCallsEnabled) systems.push('Tools');
    if (resolvedExecutionMode === 'editor') systems.push('Editor');
    if (rewardEnabled) systems.push('Reward');
    if (hhemEnabled) systems.push('HHEM');
    if (ragasEnabled) systems.push('RAGAS');
    panel.webview.postMessage({ 
      type: 'pipelineStatus', 
      icon: '⚙️', 
      text: `Aktivní: ${systems.join(', ')}`, 
      statusType: 'planning', 
      loading: false 
    });
  }

  if (shouldPlan) {
    outputChannel?.appendLine('');
    outputChannel?.appendLine('╔══════════════════════════════════════════════════════════════╗');
    outputChannel?.appendLine('║          🧠 ROZUM - PRE-PLANNING FÁZE                        ║');
    outputChannel?.appendLine('╚══════════════════════════════════════════════════════════════╝');
    
    if (panel && panel.visible) {
      panel.webview.postMessage({ type: 'rozumPlanning' });
    }

    rozumPlan = await rozum.plan(
      trimmedPrompt,
      messages,
      (status: string) => {
        if (panel && panel.visible) {
          panel.webview.postMessage({ type: 'pipelineStatus', icon: '🧠', text: status, statusType: 'planning', loading: true });
        }
      }
    );

    if (rozumPlan.shouldPlan && rozumPlan.steps.length > 0) {
      outputChannel?.appendLine(`[Rozum] ✅ Plán vytvořen: ${rozumPlan.totalSteps} kroků`);
      
      // Send plan to UI
      if (panel && panel.visible) {
        panel.webview.postMessage({ 
          type: 'rozumPlanReady',
          plan: {
            complexity: rozumPlan.complexity,
            totalSteps: rozumPlan.totalSteps,
            steps: rozumPlan.steps.map(s => ({
              id: s.id,
              type: s.type,
              title: s.title,
              emoji: rozum.getStepEmoji(s.type)
            })),
            approach: rozumPlan.suggestedApproach
          }
        });
      }

      // === STEP-BY-STEP EXECUTION ===
      outputChannel?.appendLine('');
      outputChannel?.appendLine('┌─────────────────────────────────────────────────────────────┐');
      outputChannel?.appendLine('│ STEP-BY-STEP EXECUTION WITH REVIEW                         │');
      outputChannel?.appendLine('└─────────────────────────────────────────────────────────────┘');
      orchestrator.transition('act', { strategy: 'step-by-step' });

      const stepResults = await rozum.executeStepByStep(
        rozumPlan,
        trimmedPrompt,
        // Execute step function
        async (stepPrompt: string, stepInfo: ActionStep): Promise<string> => {
          if (toolCallsEnabled) {
            const stepRequirements = getToolRequirements(stepPrompt);
            const stepToolOnlyPrompt = stepRequirements.requireToolCall
              ? buildToolOnlyPrompt(stepRequirements.requireMutation)
              : toolSystemPrompt;
            return await generateWithTools(
              panel,
              baseUrl,
              writerModel,
              stepToolOnlyPrompt,
              [{ role: 'user', content: stepPrompt }],
              stepTimeout,
              effectiveAutoSteps,
              toolsConfirmEdits,
              stepRequirements,
              {
                forceJson: stepRequirements.requireToolCall,
                systemPromptOverride: stepToolOnlyPrompt,
                primaryModel: toolPrimaryModel,
                fallbackModel: toolsFallbackModel
              },
              undefined,
              toolSession,
              autoApprovePolicy
            );
          }

          return await executeModelCall(
            panel,
            baseUrl,
            writerModel,
            toolSystemPrompt,
            stepPrompt,
            stepTimeout,
            guardianEnabled,
            true,
            stepTimeout
          );
        },
        // On step start
        (step, index, total) => {
          if (panel && panel.visible) {
            panel.webview.postMessage({
              type: 'stepStart',
              step: {
                id: step.id,
                type: step.type,
                title: step.title,
                emoji: rozum.getStepEmoji(step.type),
                current: index + 1,
                total: total
              }
            });
          }
        },
        // On step complete (no streaming - wait for full approval)
        (step, result) => {
          if (panel && panel.visible) {
            panel.webview.postMessage({
              type: 'stepComplete',
              step: {
                id: step.id,
                title: step.title,
                emoji: rozum.getStepEmoji(step.type)
              },
              result: result.slice(0, 100) + '...' // Short preview only
            });
            // Response will be sent after full pipeline approval
          }
        },
        // On step review (Rozum review callback)
        (step, approved, feedback) => {
          if (panel && panel.visible) {
            panel.webview.postMessage({
              type: 'stepReview',
              step: {
                id: step.id,
                title: step.title,
                emoji: rozum.getStepEmoji(step.type)
              },
              approved,
              feedback
            });
          }
        },
        // On svedomi validation callback
        async (step, result): Promise<{ approved: boolean; reason: string }> => {
          if (!miniModelEnabled) return { approved: true, reason: 'svedomi vypnuto' };
          
          if (panel && panel.visible) {
            panel.webview.postMessage({ type: 'svedomiValidating' });
          }

          const svedomiResult = await svedomi.validate(
            `Krok ${step.id}: ${step.instruction}`,
            result,
            (status: string) => {
              if (panel && panel.visible) {
                panel.webview.postMessage({ type: 'pipelineStatus', icon: '🧠', text: status, statusType: 'validation', loading: true });
              }
            }
          );

          if (panel && panel.visible) {
            panel.webview.postMessage({ type: 'svedomiValidationDone' });
            panel.webview.postMessage({
              type: 'stepSvedomi',
              step: { id: step.id },
              result: svedomiResult
            });
          }

          outputChannel?.appendLine(`[svedomi] Krok ${step.id}: skóre ${svedomiResult.score}/10 - ${svedomiResult.reason}`);
          
          const approved = svedomiResult.unavailable
            ? validationPolicy === 'fail-soft'
            : svedomiResult.score >= 5;
          return {
            approved,
            reason: svedomiResult.reason
          };
        },
        // On status update
        (status: string) => {
          if (panel && panel.visible) {
            panel.webview.postMessage({ type: 'pipelineStatus', icon: 'ℹ️', text: status, statusType: 'step', loading: false });
          }
        }
      );

      // Combine all step results
      let fullResponse = stepResults.map((result, i) => {
        const step = rozumPlan!.steps[i];
        if (step) {
          return `### ${rozum.getStepEmoji(step.type)} Krok ${step.id}: ${step.title}\n\n${result}`;
        }
        return result;
      }).join('\n\n---\n\n');

      let postEditVerification: VerificationSummary | null = null;
      if (toolSession.hadMutations) {
        postToAllWebviews({ type: 'pipelineStatus', icon: '✅', text: 'Overuji lint/test/build po editaci...', statusType: 'validation', loading: true });
        postEditVerification = await runPostEditVerification(stepTimeout);
        if (postEditVerification.ran.length > 0) {
          for (const cmd of postEditVerification.ran) {
            outputChannel?.appendLine(`[Verify] ${cmd.command} => ${cmd.ok ? 'OK' : `FAIL(${cmd.exitCode})`}`);
          }
        }
        if (!postEditVerification.ok) {
          const firstFail = postEditVerification.failed[0];
          const detail = firstFail ? `${firstFail.command} failed` : 'verification failed';
          if (validationPolicy === 'fail-closed') {
            postToAllWebviews({ type: 'responseError', text: `Publish blocked by verification: ${detail}` });
            return;
          }
          postToAllWebviews({ type: 'guardianAlert', message: `Verify warning: ${detail}` });
          fullResponse += `\n\n[Verify warning] ${detail}`;
        }
      }
      orchestrator.transition('verify', { stepMode: true, hadMutations: toolSession.hadMutations });
      
      // === LOCAL VALIDATION ===
      if (panel && panel.visible) {
        panel.webview.postMessage({ type: 'pipelineStatus', icon: '[H]', text: 'Kontrola halucinaci...', statusType: 'validation', loading: true });
      }

      const hallucinationResult = hallucinationDetector.analyze(fullResponse, trimmedPrompt, chatMessages);
      if (hallucinationResult.isHallucination) {
        guardianStats.hallucinationsDetected++;
        outputChannel?.appendLine(`[HallucinationDetector] HALUCINACE detekovana (${(hallucinationResult.confidence * 100).toFixed(1)}%)`);
        postToAllWebviews({ 
          type: 'guardianAlert', 
          message: `Halucinace: ${hallucinationDetector.getSummary(hallucinationResult)}` 
        });
      } else {
        outputChannel?.appendLine(`[HallucinationDetector] OK: ${hallucinationDetector.getSummary(hallucinationResult)}`);
      }

      let guardianResult: GuardianResult = {
        isOk: true,
        cleanedResponse: fullResponse,
        issues: [],
        shouldRetry: false,
        loopDetected: false,
        repetitionScore: 0
      };

      if (guardianEnabled) {
        if (panel && panel.visible) {
          panel.webview.postMessage({ type: 'pipelineStatus', icon: '[G]', text: 'Guardian kontroluje vzory...', statusType: 'validation', loading: true });
        }

        guardianResult = guardian.analyze(fullResponse, trimmedPrompt);

        if (panel && panel.visible) {
          panel.webview.postMessage({
            type: 'guardianStatus',
            result: {
              isOk: guardianResult.isOk,
              issues: guardianResult.issues,
              repetitionScore: guardianResult.repetitionScore,
              loopDetected: guardianResult.loopDetected
            }
          });
        }

        if (!guardianResult.isOk) {
          fullResponse = guardianResult.cleanedResponse;
          if (panel && panel.visible && guardianResult.issues.length > 0) {
            panel.webview.postMessage({
              type: 'guardianAlert',
              message: `Guardian: ${guardianResult.issues.join(', ')}`
            });
          }
        }
      }

      if (panel && panel.visible) {
        postToAllWebviews({
          type: 'pipelineStatus',
          icon: PIPELINE_STATUS_ICONS.history,
          text: PIPELINE_STATUS_TEXT.checkingHistory,
          statusType: 'validation',
          loading: true
        });
      }

      const similarityCheck = responseHistoryManager.checkSimilarity(fullResponse, trimmedPrompt);
      if (similarityCheck.isSimilar) {
        outputChannel?.appendLine(`[ResponseHistory] Podobna odpoved nalezena (${(similarityCheck.similarity * 100).toFixed(1)}%)`);
        postToAllWebviews({ 
          type: 'guardianAlert', 
          message: `Podobna odpoved v historii (${(similarityCheck.similarity * 100).toFixed(0)}%)` 
        });
      } else {
        outputChannel?.appendLine('[ResponseHistory] Odpověď je unikátní');
      }

      let miniResult: MiniModelResult | null = null;
      if (miniModelEnabled) {
        // Show validation status in chat
        postToAllWebviews({
          type: 'pipelineStatus',
          icon: PIPELINE_STATUS_ICONS.svedomi,
          text: PIPELINE_STATUS_TEXT.svedomiValidation,
          statusType: 'validation',
          loading: true
        });
        // Signal loader start
        postToAllWebviews({ type: 'svedomiValidating' });
        miniResult = await svedomi.validate(
          trimmedPrompt,
          fullResponse,
          (status: string) => {
            postToAllWebviews({ type: 'pipelineStatus', icon: '🧠', text: status, statusType: 'validation', loading: true });
          }
        );
      
        // Signal loader done
        postToAllWebviews({ type: 'svedomiValidationDone' });
        postToAllWebviews({ type: 'miniModelResult', result: miniResult });
      } else {
        outputChannel?.appendLine('[Svedomi] Mini-model je vypnut');
      }

      if (miniResult?.unavailable) {
        const policyMessage = getMiniUnavailableMessage(validationPolicy);
        postToAllWebviews({ type: 'guardianAlert', message: policyMessage });
      }
      if (validationPolicy === 'fail-closed' && !isMiniAccepted(miniResult, validationPolicy)) {
        postToAllWebviews({
          type: 'responseError',
          text: `Publish blocked by validation policy: ${miniResult?.reason ?? 'Validation failed'}`
        });
        return;
      }

      const qualityChecks: QualityCheckResult[] = [];
      qualityChecks.push({
        name: 'Guardian',
        ok: guardianEnabled ? guardianResult.isOk : true,
        unavailable: !guardianEnabled,
        details: guardianEnabled
          ? (guardianResult.issues.length > 0 ? guardianResult.issues.join(', ') : undefined)
          : 'Vypnuto'
      });
      qualityChecks.push({
        name: 'HallucinationDetector',
        ok: !hallucinationResult.isHallucination,
        score: hallucinationResult.confidence,
        threshold: 0.7,
        details: hallucinationDetector.getSummary(hallucinationResult)
      });
      if (miniResult) {
        const svedomiOk = isMiniAccepted(miniResult, validationPolicy);
        qualityChecks.push({
          name: 'svedomi',
          ok: svedomiOk,
          score: miniResult.score,
          threshold: 5,
          details: miniResult.reason,
          unavailable: miniResult.unavailable
        });
      }
      if (postEditVerification) {
        qualityChecks.push({
          name: 'post-edit verify',
          ok: postEditVerification.ok,
          unavailable: postEditVerification.ran.length === 0,
          details: postEditVerification.ok
            ? (postEditVerification.ran.length > 0 ? 'lint/test/build OK' : 'No verification scripts')
            : (postEditVerification.failed[0]?.command || 'Verification failed')
        });
      }

      const external = await runExternalValidators(panel, trimmedPrompt, fullResponse, {
        rewardEnabled,
        rewardEndpoint,
        rewardThreshold,
        hhemEnabled,
        hhemEndpoint,
        hhemThreshold,
        ragasEnabled,
        ragasEndpoint,
        ragasThreshold,
        timeoutMs: timeout
      }, validatorLogsEnabled);
      qualityChecks.push(...external.results);

      const summary = summarizerEnabled
        ? await summarizeResponse(baseUrl, summarizerModel, trimmedPrompt, fullResponse, timeout)
        : null;
      const responseForHistory = fullResponse;
      const appendix = buildStructuredOutput('', summary, qualityChecks, false).trim();
      fullResponse = buildStructuredOutput(fullResponse, summary, qualityChecks, false);

      if (appendix) {
        postToAllWebviews({ type: 'responseChunk', text: `\n\n${appendix}` });
      }
      
      postToAllWebviews({ type: 'rozumPlanningDone' });
      postToAllWebviews({ type: 'allStepsComplete', totalSteps: rozumPlan!.totalSteps });
      
      // === SEND FULL RESPONSE AFTER PIPELINE APPROVAL ===
      orchestrator.transition('publish', { stepMode: true, checkpoints: orchestrator.getCheckpoints().length });
      postToAllWebviews({ 
        type: 'pipelineApproved',
        message: 'Odpoved schvalena Rozumem a validaci'
      });
      postToAllWebviews({ type: 'responseChunk', text: fullResponse });

      // Log final pipeline summary
      outputChannel?.appendLine('');
      outputChannel?.appendLine('╔══════════════════════════════════════════════════════════════╗');
      outputChannel?.appendLine('║          ✅ PIPELINE DOKONČEN                                ║');
      outputChannel?.appendLine('╚══════════════════════════════════════════════════════════════╝');
      outputChannel?.appendLine(`[Pipeline] Celkem kroků: ${rozumPlan.totalSteps}`);
      outputChannel?.appendLine(`[Pipeline] Úspěšně dokončeno: ${stepResults.length}`);
      outputChannel?.appendLine('');

      // Save assistant response
      messages.push({ role: 'assistant', content: fullResponse, timestamp: Date.now() });
      await saveChatMessages(context, messages);
      const finalScore = miniResult?.score || 7;
      responseHistoryManager.addResponse(responseForHistory, trimmedPrompt, finalScore);

      postToAllWebviews({ type: 'responseDone' });

      return; // Exit early - we handled everything in step-by-step mode
    } else {
      outputChannel?.appendLine(`[Rozum] ⏭️ Plánování přeskočeno (jednoduchý dotaz nebo žádné kroky)`);
    }

    postToAllWebviews({ type: 'rozumPlanningDone' });
  } else {
    // Rozum skipped - show simple status
    if (panel && panel.visible) {
      panel.webview.postMessage({
        type: 'pipelineStatus',
        icon: PIPELINE_STATUS_ICONS.chat,
        text: PIPELINE_STATUS_TEXT.generatingResponse,
        statusType: 'step',
        loading: true
      });
    }
  }

  // === STANDARD SINGLE-CALL MODE (no steps) ===
  const apiMessages: ChatMessage[] = [
    { role: 'system', content: toolSystemPrompt },
    ...messages
  ];

  const url = `${baseUrl}/api/chat`;
  abortController = new AbortController();

  let fullResponse = '';
  let streamedToUi = false;
  let lastChunkTime = Date.now();
  const STALL_TIMEOUT = 10000; // 10s without new content = stall

  try {
    if (orchestrator.getCurrent() !== 'act') {
      orchestrator.transition('act', { strategy: 'single-call' });
    }
    if (resolvedExecutionMode === 'editor') {
      if (panel && panel.visible) {
        panel.webview.postMessage({
          type: 'pipelineStatus',
          icon: PIPELINE_STATUS_ICONS.editor,
          text: PIPELINE_STATUS_TEXT.editorApplying,
          statusType: 'step',
          loading: true
        });
      }
      fullResponse = await generateEditorFirstResponse(
        panel,
        baseUrl,
        toolPrimaryModel,
        editorSystemPrompt,
        messages,
        stepTimeout,
        effectiveAutoSteps,
        toolsConfirmEdits,
        toolsFallbackModel,
        abortController.signal,
        toolSession,
        autoApprovePolicy
      );
    } else if (toolCallsEnabled) {
      if (panel && panel.visible) {
        panel.webview.postMessage({ 
          type: 'pipelineStatus', 
          icon: PIPELINE_STATUS_ICONS.tools,
          text: PIPELINE_STATUS_TEXT.toolsActive,
          statusType: 'step', 
          loading: true 
        });
      }
      fullResponse = await generateWithTools(
        panel,
        baseUrl,
        writerModel,
        toolPromptForMain,
        messages,
        stepTimeout,
        effectiveAutoSteps,
        toolsConfirmEdits,
        toolRequirements,
        {
          forceJson: toolRequirements.requireToolCall,
          systemPromptOverride: toolPromptForMain,
          primaryModel: toolPrimaryModel,
          fallbackModel: toolsFallbackModel
        },
        abortController.signal,
        toolSession,
        autoApprovePolicy
      );
    } else {
      streamedToUi = true;
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: writerModel,
          stream: true,
          messages: apiMessages,
          options: {
            repeat_penalty: 1.2,  // Penalize repetition
            repeat_last_n: 256,   // Look back 256 tokens
            num_predict: getMaxOutputTokens(2048),    // Limit max tokens
            num_ctx: getContextTokens()
          }
        }),
        signal: abortController.signal
      }, timeout);

    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const decoder = new TextDecoder();
    let buffer = '';

    // Real-time loop detection during streaming
    let recentChunks: string[] = [];
    const CHUNK_WINDOW = 20;

    // Iterate over readable stream chunks
    // Safety: check body exists and is iterable
    if (!res.body || typeof res.body[Symbol.asyncIterator] !== 'function') {
      throw new Error('Response body is not readable stream');
    }
    
    for await (const chunk of res.body as any) {
      if (!chunk) continue;
      // Check for stall
      const now = Date.now();
      if (now - lastChunkTime > STALL_TIMEOUT && fullResponse.length > 100) {
        outputChannel?.appendLine('[Guardian] Stall detected, stopping generation');
        break;
      }
      lastChunkTime = now;

      buffer += decoder.decode(chunk, { stream: true });

      // Prevent buffer overflow - if buffer grows too large without newlines, something is wrong
      if (buffer.length > 100000) {
        outputChannel?.appendLine('[Error] Buffer overflow detected, stopping stream');
        if (abortController && !abortController.signal.aborted) {
          abortController.abort();
        }
        break;
      }

      let newlineIndex;
      let linesProcessed = 0;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        // Safety: prevent infinite loop on malformed stream
        if (++linesProcessed > 10000) {
          outputChannel?.appendLine('[Warning] Stream processing limit reached');
          break;
        }
        
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;

        try {
          const json = JSON.parse(line);
          // Validate JSON structure
          if (!json || typeof json !== 'object') {
            continue;
          }
          // Additional safety: check message object exists
          if (!json.message || typeof json.message !== 'object') {
            continue;
          }
          const delta = json.message.content || '';
          if (delta) {
            fullResponse += delta;
            
            // Safety check - prevent extremely long responses from freezing UI
            if (fullResponse.length > 500000) {
              outputChannel?.appendLine('[Warning] Response too long, truncating');
              fullResponse = fullResponse.slice(0, 500000) + '\n\n[Odpověď zkrácena - příliš dlouhá]';
              if (abortController && !abortController.signal.aborted) {
                abortController.abort();
              }
              break;
            }
            
            // Real-time loop detection
            if (guardianEnabled) {
              recentChunks.push(delta);
              if (recentChunks.length > CHUNK_WINDOW) {
                recentChunks.shift();
              }
              
              // Check for real-time loop
              const recentText = recentChunks.join('');
              if (recentText.length > 100) {
                const halfLen = Math.floor(recentText.length / 2);
                const firstHalf = recentText.slice(0, halfLen);
                const secondHalf = recentText.slice(recentText.length - halfLen);
                if (firstHalf === secondHalf && firstHalf.length > 0) {
                  outputChannel?.appendLine('[Guardian] Real-time loop detected, stopping');
                  panel.webview.postMessage({ 
                    type: 'guardianAlert', 
                    message: '🛡️ Smyčka detekována, zastavuji generování' 
                  });
                  if (abortController && !abortController.signal.aborted) {
                    abortController.abort();
                  }
                  break;
                }
              }
            }

            panel.webview.postMessage({ type: 'responseChunk', text: delta });
          }
        } catch {
          // Ignore malformed JSON
        }
      }
    }
  }

    let postEditVerification: VerificationSummary | null = null;
    if (fullResponse && toolSession.hadMutations) {
      postToAllWebviews({ type: 'pipelineStatus', icon: '✅', text: 'Overuji lint/test/build po editaci...', statusType: 'validation', loading: true });
      postEditVerification = await runPostEditVerification(stepTimeout);
      if (postEditVerification.ran.length > 0) {
        for (const cmd of postEditVerification.ran) {
          outputChannel?.appendLine(`[Verify] ${cmd.command} => ${cmd.ok ? 'OK' : `FAIL(${cmd.exitCode})`}`);
        }
      }
      if (!postEditVerification.ok) {
        const firstFail = postEditVerification.failed[0];
        const detail = firstFail ? `${firstFail.command} failed` : 'verification failed';
        if (validationPolicy === 'fail-closed') {
          postToAllWebviews({ type: 'responseError', text: `Publish blocked by verification: ${detail}` });
          return;
        }
        postToAllWebviews({ type: 'guardianAlert', message: `Verify warning: ${detail}` });
        fullResponse += `\n\n[Verify warning] ${detail}`;
      }
    }
    orchestrator.transition('verify', { stepMode: false, hadMutations: toolSession.hadMutations });

    // === GUARDIAN POST-PROCESSING ===
    if (fullResponse) {
      outputChannel?.appendLine('');
      outputChannel?.appendLine('╔══════════════════════════════════════════════════════════════╗');
      outputChannel?.appendLine('║          🛡️ VALIDAČNÍ SYSTÉMY - ANALÝZA ODPOVĚDI            ║');
      outputChannel?.appendLine('╚══════════════════════════════════════════════════════════════╝');
      outputChannel?.appendLine(`[Prompt] ${trimmedPrompt.slice(0, 100)}...`);
      outputChannel?.appendLine(`[Response] ${fullResponse.slice(0, 200)}...`);
      outputChannel?.appendLine('');

      // === SYSTEM 1: HALLUCINATION DETECTOR ===
      outputChannel?.appendLine('┌─────────────────────────────────────────────────────────────┐');
      outputChannel?.appendLine('│ SYSTÉM 1: HallucinationDetector                             │');
      outputChannel?.appendLine('└─────────────────────────────────────────────────────────────┘');
      
      // Show hallucination check status in chat
      if (panel && panel.visible) {
        panel.webview.postMessage({ type: 'pipelineStatus', icon: '🔮', text: 'Kontrola halucinací...', statusType: 'validation', loading: true });
      }
      
      const hallucinationResult = hallucinationDetector.analyze(fullResponse, trimmedPrompt, chatMessages);
      if (hallucinationResult.isHallucination) {
        guardianStats.hallucinationsDetected++;
        outputChannel?.appendLine(`[HallucinationDetector] 🚨 HALUCINACE DETEKOVÁNA!`);
        outputChannel?.appendLine(`[HallucinationDetector] Kategorie: ${hallucinationResult.category}`);
        outputChannel?.appendLine(`[HallucinationDetector] Confidence: ${(hallucinationResult.confidence * 100).toFixed(1)}%`);
        
        // Notify UI
        postToAllWebviews({ 
          type: 'guardianAlert', 
          message: `🔮 Halucinace: ${hallucinationDetector.getSummary(hallucinationResult)}` 
        });
      } else {
        outputChannel?.appendLine(`[HallucinationDetector] ✅ ${hallucinationDetector.getSummary(hallucinationResult)}`);
      }
      outputChannel?.appendLine('');

      let guardianResult: GuardianResult = {
        isOk: true,
        cleanedResponse: fullResponse,
        issues: [],
        shouldRetry: false,
        loopDetected: false,
        repetitionScore: 0
      };

      if (guardianEnabled) {
      // === SYSTEM 2: RESPONSE GUARDIAN ===
      outputChannel?.appendLine('┌─────────────────────────────────────────────────────────────┐');
      outputChannel?.appendLine('│ SYSTÉM 2: ResponseGuardian                                  │');
      outputChannel?.appendLine('└─────────────────────────────────────────────────────────────┘');
      
            
      // Show Guardian status in chat
      
      postToAllWebviews({ type: 'pipelineStatus', icon: '🛡️', text: 'Guardian kontroluje vzory...', statusType: 'validation', loading: true });
      
      
      guardianResult = guardian.analyze(fullResponse, trimmedPrompt);
      
      
      outputChannel?.appendLine(`[ResponseGuardian] isOk: ${guardianResult.isOk}`);
      
      outputChannel?.appendLine(`[ResponseGuardian] loopDetected: ${guardianResult.loopDetected}`);
      
      outputChannel?.appendLine(`[ResponseGuardian] repetitionScore: ${(guardianResult.repetitionScore * 100).toFixed(1)}%`);
      
      if (guardianResult.issues.length > 0) {
      
        outputChannel?.appendLine(`[ResponseGuardian] Issues:`);
      
        guardianResult.issues.forEach(issue => {
      
          outputChannel?.appendLine(`[ResponseGuardian]   - ${issue}`);
      
        });
      
      }
      
      outputChannel?.appendLine('');
      
      
      // Send guardian status to UI
      
      postToAllWebviews({ 
      
        type: 'guardianStatus', 
      
        result: {
      
          isOk: guardianResult.isOk,
      
          issues: guardianResult.issues,
      
          repetitionScore: guardianResult.repetitionScore,
      
          loopDetected: guardianResult.loopDetected
      
        }
      
      });

      
      // Apply cleaned response
      
      if (!guardianResult.isOk) {
      
        fullResponse = guardianResult.cleanedResponse;
  
      
        // Notify UI about cleaning
      
        if (guardianResult.issues.length > 0) {
      
          postToAllWebviews({ 
      
            type: 'guardianAlert', 
      
            message: `Guardian: ${guardianResult.issues.join(', ')}` 
      
          });
      
        }
      
      }

      }

// === RESPONSE HISTORY CHECK ===
      outputChannel?.appendLine('┌─────────────────────────────────────────────────────────────┐');
      outputChannel?.appendLine('│ SYSTÉM 3: ResponseHistoryManager                            │');
      outputChannel?.appendLine('└─────────────────────────────────────────────────────────────┘');
      
      // Show history check status
      postToAllWebviews({
        type: 'pipelineStatus',
        icon: PIPELINE_STATUS_ICONS.history,
        text: PIPELINE_STATUS_TEXT.checkingHistory,
        statusType: 'validation',
        loading: true
      });
      
      const similarityCheck = responseHistoryManager.checkSimilarity(fullResponse, trimmedPrompt);
      if (similarityCheck.isSimilar) {
        outputChannel?.appendLine(`[ResponseHistory] ⚠️ Podobná odpověď nalezena!`);
        outputChannel?.appendLine(`[ResponseHistory] Podobnost: ${(similarityCheck.similarity * 100).toFixed(1)}%`);
        outputChannel?.appendLine(`[ResponseHistory] Index v historii: ${similarityCheck.matchedIndex}`);
        
        postToAllWebviews({ 
          type: 'guardianAlert', 
          message: `📋 Podobná odpověď v historii (${(similarityCheck.similarity * 100).toFixed(0)}%)` 
        });
      } else {
        outputChannel?.appendLine(`[ResponseHistory] ✅ Odpověď je unikátní`);
      }
      
      const historyStats = responseHistoryManager.getStats();
      outputChannel?.appendLine(`[ResponseHistory] Historie: ${historyStats.total} odpovědí, průměrné skóre: ${historyStats.avgScore.toFixed(1)}`);
      outputChannel?.appendLine('');

      // === MINI-MODEL VALIDATION (SVĚDOMÍ) ===
      outputChannel?.appendLine('┌─────────────────────────────────────────────────────────────┐');
      outputChannel?.appendLine('│ SYSTÉM 4: svedomi (Mini-model Validator)                    │');
      outputChannel?.appendLine('└─────────────────────────────────────────────────────────────┘');
      
      // Run even if Guardian wants retry to get comprehensive feedback
      let miniResult: MiniModelResult | null = null;
      if (miniModelEnabled) {
        // Show validation status in chat
        postToAllWebviews({
          type: 'pipelineStatus',
          icon: PIPELINE_STATUS_ICONS.svedomi,
          text: PIPELINE_STATUS_TEXT.svedomiValidation,
          statusType: 'validation',
          loading: true
        });
        // Signal loader start
        postToAllWebviews({ type: 'svedomiValidating' });
        miniResult = await svedomi.validate(
          trimmedPrompt,
          fullResponse,
          (status: string) => {
            postToAllWebviews({ type: 'pipelineStatus', icon: '🧠', text: status, statusType: 'validation', loading: true });
          }
        );
      
        // Signal loader done
        postToAllWebviews({ type: 'svedomiValidationDone' });
        postToAllWebviews({ type: 'miniModelResult', result: miniResult });
      } else {
        outputChannel?.appendLine('[Svedomi] Mini-model je vypnut');
      }
      const miniUnavailable = Boolean(miniResult?.unavailable);
      if (miniUnavailable) {
        postToAllWebviews({
          type: 'guardianAlert',
          message: getMiniUnavailableMessage(validationPolicy, true)
        });
      }
      outputChannel?.appendLine('');

      const qualityChecks: QualityCheckResult[] = [];
      qualityChecks.push({
        name: 'Guardian',
        ok: guardianEnabled ? guardianResult.isOk : true,
        unavailable: !guardianEnabled,
        details: guardianEnabled
          ? (guardianResult.issues.length > 0 ? guardianResult.issues.join(', ') : undefined)
          : 'Vypnuto'
      });
      qualityChecks.push({
        name: 'HallucinationDetector',
        ok: !hallucinationResult.isHallucination,
        score: hallucinationResult.confidence,
        threshold: 0.7,
        details: hallucinationDetector.getSummary(hallucinationResult)
      });
      if (miniResult) {
        const svedomiOk = isMiniAccepted(miniResult, validationPolicy);
        qualityChecks.push({
          name: 'svedomi',
          ok: svedomiOk,
          score: miniResult.score,
          threshold: 5,
          details: miniResult.reason,
          unavailable: miniResult.unavailable
        });
      }
      if (postEditVerification) {
        qualityChecks.push({
          name: 'post-edit verify',
          ok: postEditVerification.ok,
          unavailable: postEditVerification.ran.length === 0,
          details: postEditVerification.ok
            ? (postEditVerification.ran.length > 0 ? 'lint/test/build OK' : 'No verification scripts')
            : (postEditVerification.failed[0]?.command || 'Verification failed')
        });
      }

      // === EXTERNAL VALIDATORS (Reward / HHEM / RAGAS) ===
      const external = await runExternalValidators(panel, trimmedPrompt, fullResponse, {
        rewardEnabled,
        rewardEndpoint,
        rewardThreshold,
        hhemEnabled,
        hhemEndpoint,
        hhemThreshold,
        ragasEnabled,
        ragasEndpoint,
        ragasThreshold,
        timeoutMs: timeout
      }, validatorLogsEnabled);
      const rewardResult = external.rewardResult;
      const hhemResult = external.hhemResult;
      const ragasResult = external.ragasResult;
      qualityChecks.push(...external.results);

      // === UNIFIED RETRY LOGIC ===
      // Prioritize mini-model decision, fallback to Guardian
      const shouldRetryMini = shouldRetryMiniValidation(miniResult, validationPolicy);
      const shouldRetryGuardian = guardianResult.shouldRetry;
      const shouldRetryHallucination = hallucinationResult.isHallucination && hallucinationResult.confidence > 0.7;
      const shouldRetryReward = rewardEnabled && !rewardResult.ok && !rewardResult.unavailable;
      const shouldRetryHhem = hhemEnabled && !hhemResult.ok && !hhemResult.unavailable;
      const shouldRetryRagas = ragasEnabled && !ragasResult.ok && !ragasResult.unavailable;
      const shouldRetryAny = shouldRetryMini || shouldRetryGuardian || shouldRetryHallucination || shouldRetryReward || shouldRetryHhem || shouldRetryRagas;
      const retryBlockedByTools = toolsEnabled && toolSession.hadMutations;
      
      if (shouldRetryAny
        && retryCount < maxRetries
        && !retryBlockedByTools
      ) {
        const retrySource = shouldRetryHallucination
          ? 'Hallucination'
          : (shouldRetryMini
            ? 'Mini-model'
            : (shouldRetryReward
              ? 'Reward'
              : (shouldRetryHhem ? 'HHEM' : (shouldRetryRagas ? 'RAGAS' : 'Guardian'))));
        const retryDetail = shouldRetryHallucination
          ? `Halucinace ${(hallucinationResult.confidence * 100).toFixed(0)}%`
          : (shouldRetryMini 
            ? `Skóre ${miniResult!.score}/10 - ${miniResult!.reason}` 
            : (shouldRetryReward
              ? `Reward pod prahem ${rewardThreshold}`
              : (shouldRetryHhem
                ? `HHEM pod prahem ${hhemThreshold}`
                : (shouldRetryRagas ? `RAGAS pod prahem ${ragasThreshold}` : `Problém detekován`))));
        
        const retryFeedbackMessage = [
          `Duvod: ${retrySource} - ${retryDetail}`,
          guardianEnabled && guardianResult.issues.length > 0 ? `Guardian: ${guardianResult.issues.join(', ')}` : '',
          miniResult ? `Svedomi: ${miniResult.score}/10 - ${miniResult.reason}` : '',
          hallucinationResult.isHallucination ? `Halucinace: ${hallucinationDetector.getSummary(hallucinationResult)}` : ''
        ].filter(Boolean).join('\n');

        outputChannel?.appendLine(`[Retry] 🔄 Spouštím retry - důvod: ${retrySource}`);
        guardianStats.retriesTriggered++;
        
        // Check panel before retry message
        postToAllWebviews({ 
          type: 'guardianAlert', 
          message: `🔄 ${retrySource}: ${retryDetail}. Zkouším znovu (${retryCount + 1}/${maxRetries})` 
        });
        
        // Remove failed assistant response attempt
        if (messages[messages.length - 1]?.role === 'assistant') {
          messages.pop();
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return handleChatInternal(panel, context, trimmedPrompt, messages, retryCount + 1, retryFeedbackMessage);
      }
      if (retryBlockedByTools && shouldRetryAny) {
        outputChannel?.appendLine('[Retry] Skipping retry because tool edits were applied');
        if (validationPolicy === 'fail-closed') {
          postToAllWebviews({ type: 'responseError', text: 'Publish blocked: fail-closed validation policy.' });
          return;
        }
      }

      // === LOG FINAL STATS ===
      outputChannel?.appendLine('');
      outputChannel?.appendLine('┌─────────────────────────────────────────────────────────────┐');
      outputChannel?.appendLine('│ VÝSLEDEK VALIDACE                                           │');
      outputChannel?.appendLine('└─────────────────────────────────────────────────────────────┘');
      outputChannel?.appendLine(`[Stats] Celkem kontrol: ${guardianStats.totalChecks}`);
      outputChannel?.appendLine(`[Stats] Detekované smyčky: ${guardianStats.loopsDetected}`);
      outputChannel?.appendLine(`[Stats] Opravená opakování: ${guardianStats.repetitionsFixed}`);
      outputChannel?.appendLine(`[Stats] Halucinace: ${guardianStats.hallucinationsDetected}`);
      outputChannel?.appendLine(`[Stats] Podobné odpovědi: ${guardianStats.similarResponsesBlocked}`);
      outputChannel?.appendLine(`[Stats] Mini-model validací: ${guardianStats.miniModelValidations}`);
      outputChannel?.appendLine(`[Stats] Mini-model zamítnutí: ${guardianStats.miniModelRejections}`);
      outputChannel?.appendLine('╔══════════════════════════════════════════════════════════════╗');
      outputChannel?.appendLine('║          ✅ VALIDACE DOKONČENA                               ║');
      outputChannel?.appendLine('╚══════════════════════════════════════════════════════════════╝');
      outputChannel?.appendLine('');

      const summary = summarizerEnabled
        ? await summarizeResponse(baseUrl, summarizerModel, trimmedPrompt, fullResponse, timeout)
        : null;
      const responseForHistory = fullResponse;
      fullResponse = buildStructuredOutput(fullResponse, summary, qualityChecks);

      // Signal pipeline approval and send response
      orchestrator.transition('publish', { stepMode: false, checkpoints: orchestrator.getCheckpoints().length });
      postToAllWebviews({
        type: 'pipelineApproved',
        message: '✅ Odpověď schválena'
      });

      // Add to response history for future similarity checks
      const finalScore = miniResult?.score || 7;
      responseHistoryManager.addResponse(responseForHistory, trimmedPrompt, finalScore);
    }

    if (!streamedToUi && fullResponse) {
      postToAllWebviews({ type: 'responseChunk', text: fullResponse });
    }

    // Save assistant response
    messages.push({ role: 'assistant', content: fullResponse, timestamp: Date.now() });
    await saveChatMessages(context, messages);

    // Check panel validity before final message
    postToAllWebviews({ type: 'responseDone' });

  } catch (err: unknown) {
    const error = err as Error;
    orchestrator.force('error', { message: error.message || String(err) });
    if (error.name === 'AbortError') {
      // Check panel validity before sending abort message
      postToAllWebviews({ type: 'responseStopped' });
      if (fullResponse) {
        // Clean partial response with guardian
        const guardianResult = guardian.analyze(fullResponse, trimmedPrompt);
        const cleanedResponse = guardianResult.cleanedResponse + '\n\n[Generování zastaveno]';
        messages.push({ role: 'assistant', content: cleanedResponse, timestamp: Date.now() });
        await saveChatMessages(context, messages);
      }
    } else {
      // Remove the user message on error (only if it was our first attempt)
      if (retryCount === 0 && messages.length > 0 && messages[messages.length - 1]?.role === 'user') {
        messages.pop();
        // Save cleaned state immediately
        try {
          await saveChatMessages(context, messages);
        } catch (e) {
          outputChannel?.appendLine(`[Error] Failed to save after error cleanup: ${String(e)}`);
        }
      }
      const errorMsg = error.message || String(err);
      outputChannel?.appendLine(`[Error] ${errorMsg}`);
      // Only send error if panel is still valid
      postToAllWebviews({ type: 'responseError', text: errorMsg });
    }
  } finally {
    outputChannel?.appendLine(`[Orchestrator] State: ${orchestrator.getCurrent()} | checkpoints=${orchestrator.getCheckpoints().length}`);
    abortController = undefined;
  }
}

// ============================================================
// UTILITIES
// ============================================================

const TOOL_CALL_REGEX = /<tool_call>([\s\S]*?)<\/tool_call>/g;
const DEFAULT_EXCLUDE_GLOB = '**/{node_modules,.git,dist,build,.next,__pycache__,.venv,venv,target,bin,obj,.idea,.vscode,coverage,.nyc_output}/**';
const DEFAULT_MAX_LIST_RESULTS = 200;
const DEFAULT_MAX_SEARCH_RESULTS = 20;
const DEFAULT_MAX_LSP_RESULTS = 200;
const DEFAULT_MAX_READ_LINES = 400;
const DEFAULT_MAX_READ_BYTES = 256 * 1024;
const DEFAULT_MAX_WRITE_BYTES = 256 * 1024;
const DEFAULT_CONTEXT_TOKENS = 8192;
const MIN_CONTEXT_TOKENS = 2048;
const MAX_CONTEXT_TOKENS = 8192;
const DEFAULT_AIRLLM_MAX_OUTPUT_TOKENS = 256;
const MIN_AIRLLM_MAX_OUTPUT_TOKENS = 16;
const DEFAULT_MAX_EDITOR_FILES = 6;
const DEFAULT_MAX_EDITOR_FILE_BYTES = 24 * 1024;
const DEFAULT_MAX_EDITOR_TOTAL_BYTES = 120 * 1024;
const DEFAULT_MAX_WARM_FILES = 4;
const DEFAULT_MAX_WARM_FILE_BYTES = 12 * 1024;
const DEFAULT_MAX_WARM_FALLBACK_RESULTS = 8;
const DEFAULT_MAX_LSP_DIAGNOSTICS = 20;
const DEFAULT_MAX_LSP_REFERENCES = 20;
const DEFAULT_MAX_DIFF_BYTES = 128 * 1024;
const DEFAULT_MAX_DIFF_LINES = 200;
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tiff',
  '.pdf', '.zip', '.gz', '.tar', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.class', '.jar', '.wasm',
  '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.wav', '.flac'
]);

function buildToolInstructions(): string {
  const autoSaveDir = getToolsAutoSaveDir();
  return [
    'TOOLING:',
    'Mas pristup k nastrojum pro praci se soubory. Kdyz potrebujes cist nebo upravovat soubory, pouzij nastroj.',
    'Format tool callu (vrat pouze tool_call bloky, bez dalsiho textu):',
    '<tool_call>{"name":"read_file","arguments":{"path":"src/extension.ts","startLine":1,"endLine":200}}</tool_call>',
    'Po kazdem tool callu dostanes vysledek:',
    '<tool_result>{"ok":true,"tool":"read_file","data":{...}}</tool_result>',
    'read_file uklada hash souboru; pred replace_lines vzdy pouzij read_file.',
    `Auto-save slozka: ${autoSaveDir}.`,
    'Kdyz nevis cestu, pouzij pick_save_path (bez dialogu) a potom write_file s vracenou cestou.',
    'U pick_save_path pouzij title/suggestedName/extension pro chytre pojmenovani.',
    'Kdyz neuvedes path u write_file/replace_lines, pouzije se aktivni soubor; write_file bez aktivniho souboru ulozi do auto-save slozky.',
    'Cilovy soubor vol sam: 1) explicitne z dotazu, 2) aktivni soubor pokud sedi tema, 3) relevantni soubory z kontextu, 4) list_files/search_in_files, 5) novy soubor do auto-save.',
    'Nezadej si o cestu, pokud to neni nezbytne; rozhodni a zapis.',
    'Pokud je workspace multi-root, pouzij cestu ve tvaru root/soubor.',
    '',
    'Dostupne nastroje:',
    '- list_files { glob?: string, maxResults?: number }',
    '- read_file { path: string, startLine?: number, endLine?: number }',
    '- get_active_file { }',
    '- search_in_files { query: string, glob?: string, maxResults?: number }',
    '- get_symbols { path?: string, maxDepth?: number, maxResults?: number }',
    '- get_workspace_symbols { query?: string, maxResults?: number }',
    '- get_definition { path?: string, line?: number, character?: number, symbol?: string }',
    '- get_references { path?: string, line?: number, character?: number, includeDeclaration?: boolean }',
    '- get_type_info { path?: string, line?: number, character?: number }',
    '- get_diagnostics { path?: string, maxResults?: number }',
    '- replace_lines { path: string, startLine: number, endLine: number, text: string, expected?: string }',
    '- apply_patch { diff: string }',
    '- write_file { path?: string, text: string, title?: string, suggestedName?: string, extension?: string }',
    '- pick_save_path { title?: string, suggestedName?: string, extension?: string } (vygeneruje cestu v auto-save slozce)',
    '- route_file { intent: string, preferredExtension?: string, fileNameHint?: string, maxResults?: number, glob?: string, allowCreate?: boolean }',
    '- rename_file { from: string, to: string }',
    '- delete_file { path: string }',
    '',
    'Pravidla:',
    '- Pri editaci nejdriv nacti soubor a pouzij replace_lines s presnymi radky.',
    '- Nehlasej, ze jsi soubor cetl/upravil bez tool_result.',
    '- Kdyz dostanes tool_result s approved:false, navrhni alternativu nebo se zeptej.'
  ].join('\n');
}

function buildToolOnlyPrompt(requireMutation: boolean): string {
  const rules = [
    'Jsi vykonavac nastroju.',
    'Odpovidej pouze JSONem bez markdownu.',
    'Format: {"name":"<tool>","arguments":{...}} nebo pole takovych objektu.',
    requireMutation
      ? 'Musis provest zmenu souboru (write_file/replace_lines).'
      : 'Musis pouzit alespon jeden tool_call.'
  ];
  const tools = [
    'list_files',
    'read_file',
    'get_active_file',
    'search_in_files',
    'get_symbols',
    'get_workspace_symbols',
    'get_definition',
    'get_references',
    'get_type_info',
    'get_diagnostics',
    'replace_lines',
    'apply_patch',
    'write_file',
    'pick_save_path',
    'route_file',
    'rename_file',
    'delete_file'
  ];
  return [...rules, `Dostupne nastroje: ${tools.join(', ')}`].join('\n');
}

function parseToolCalls(text: string): { calls: ToolCall[]; remainingText: string; errors: string[] } {
  const calls: ToolCall[] = [];
  const errors: string[] = [];
  let match: RegExpExecArray | null;

  TOOL_CALL_REGEX.lastIndex = 0;
  while ((match = TOOL_CALL_REGEX.exec(text)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) {
      errors.push('Empty tool_call payload');
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.name !== 'string') {
        errors.push('Missing tool name');
        continue;
      }
      const args = parsed.arguments && typeof parsed.arguments === 'object'
        ? parsed.arguments
        : undefined;
      calls.push({ name: parsed.name, arguments: args });
    } catch (err) {
      errors.push(`Invalid JSON: ${String(err)}`);
    }
  }

  if (calls.length === 0) {
    const candidates: string[] = [];
    const fenceRegex = /```(\w+)?\s*([\s\S]*?)```/gi;
    let fenceMatch: RegExpExecArray | null;
    while ((fenceMatch = fenceRegex.exec(text)) !== null) {
      const lang = (fenceMatch[1] || '').toLowerCase();
      if (lang && lang !== 'json') continue;
      const payload = fenceMatch[2]?.trim();
      if (!payload) continue;
      if (!payload.startsWith('{') && !payload.startsWith('[')) continue;
      candidates.push(payload);
    }
    const trimmed = text.trim();
    if (candidates.length === 0 && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
      candidates.push(trimmed);
    }

    const pushParsed = (parsed: unknown) => {
      if (!parsed) return;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const name = (item as { name?: unknown }).name;
        if (typeof name !== 'string') continue;
        const args = (item as { arguments?: unknown }).arguments;
        calls.push({
          name,
          arguments: args && typeof args === 'object' ? (args as Record<string, unknown>) : undefined
        });
      }
    };

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        pushParsed(parsed);
      } catch (err) {
        errors.push(`Invalid JSON: ${String(err)}`);
      }
    }
  }

  const remainingText = calls.length > 0 ? '' : text.replace(TOOL_CALL_REGEX, '').trim();
  return { calls, remainingText, errors };
}

interface EditorPlan {
  answer?: string;
  actions?: ToolCall[];
  notes?: string[];
}

function sanitizeEditorAnswer(answer: string, results: ToolResult[]): string {
  const trimmed = answer.trim();
  if (!trimmed) return '';
  const allOk = results.length > 0 && results.every(r => r.ok && r.approved !== false);
  const lines = trimmed.split(/\r\n|\n/);
  const filtered = lines.filter(line => {
    const lower = line.toLowerCase();
    if (/(kompil|kompilac|build|lint|test)/i.test(lower)) {
      return false;
    }
    if (allOk && /(nenalezen|neexistuje|soubor nebyl|error|fail|chyba)/i.test(lower)) {
      return false;
    }
    return true;
  });
  return filtered.join('\n').trim();
}

function formatDisplayPath(input: string): string {
  const decoded = decodePathInput(input).replace(/\\/g, '/');
  const parts = decoded.split('/').filter(Boolean);
  if (parts.length === 0) return decoded;
  const autoDir = getToolsAutoSaveDir().replace(/\\/g, '/');
  if (autoDir) {
    const autoParts = autoDir.split('/').filter(Boolean);
    if (autoParts.length > 0) {
      for (let i = 0; i <= parts.length - autoParts.length; i++) {
        let matches = true;
        for (let j = 0; j < autoParts.length; j++) {
          if (parts[i + j] !== autoParts[j]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          return parts.slice(i).join('/');
        }
      }
    }
  }
  const collapsed: string[] = [];
  for (const part of parts) {
    if (collapsed[collapsed.length - 1] !== part) {
      collapsed.push(part);
    }
  }
  let output = collapsed.join('/');
  if (output.length > 160) {
    const tail = collapsed.slice(-3).join('/');
    output = `.../${tail}`;
  }
  return output;
}

function buildEditorStateMessage(session?: ToolSessionState): string | undefined {
  if (!session) return undefined;
  const parts: string[] = [];
  if (session.lastWritePath) {
    parts.push(`last_write_path: ${session.lastWritePath}`);
  }
  if (session.lastWriteAction) {
    parts.push(`last_write_action: ${session.lastWriteAction}`);
  }
  if (parts.length === 0) return undefined;
  return ['EDITOR_STATE:', ...parts, 'Use last_write_path if you need to edit the latest file.'].join('\n');
}

function extractJsonPayload(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(text)) !== null) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    if (candidate.startsWith('{') || candidate.startsWith('[')) return candidate;
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  return undefined;
}

function coerceEditorAction(raw: Record<string, unknown>): ToolCall | null {
  const name = typeof raw.name === 'string'
    ? raw.name
    : (typeof raw.tool === 'string'
      ? raw.tool
      : (typeof raw.type === 'string'
        ? raw.type
        : (typeof raw.action === 'string' ? raw.action : '')));
  if (!name) return null;
  const args = raw.arguments && typeof raw.arguments === 'object'
    ? raw.arguments as Record<string, unknown>
    : Object.fromEntries(Object.entries(raw).filter(([key]) => !['name', 'tool', 'type', 'action'].includes(key)));
  return { name, arguments: args };
}

function parseEditorPlanResponse(text: string): { plan?: EditorPlan; error?: string } {
  const payload = extractJsonPayload(text);
  if (!payload) return { error: 'missing JSON payload' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    return { error: `invalid JSON: ${String(err)}` };
  }

  if (Array.isArray(parsed)) {
    const actions = parsed
      .map(item => (item && typeof item === 'object') ? coerceEditorAction(item as Record<string, unknown>) : null)
      .filter((item): item is ToolCall => Boolean(item));
    return { plan: { actions } };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { error: 'JSON must be object or array' };
  }

  const obj = parsed as Record<string, unknown>;
  const answer = typeof obj.answer === 'string'
    ? obj.answer
    : (typeof obj.response === 'string' ? obj.response : undefined);
  const notes = Array.isArray(obj.notes)
    ? obj.notes.filter(item => typeof item === 'string') as string[]
    : undefined;

  let rawActions: unknown = obj.actions;
  if (!Array.isArray(rawActions)) {
    rawActions = obj.toolCalls ?? obj.edits ?? obj.calls;
  }
  let actions: ToolCall[] | undefined;
  if (Array.isArray(rawActions)) {
    actions = rawActions
      .map(item => (item && typeof item === 'object') ? coerceEditorAction(item as Record<string, unknown>) : null)
      .filter((item): item is ToolCall => Boolean(item));
  } else if (obj.name || obj.tool || obj.type || obj.action) {
    const single = coerceEditorAction(obj);
    actions = single ? [single] : undefined;
  }

  return { plan: { answer, actions, notes } };
}

async function applyEditorPlan(
  panel: WebviewWrapper,
  plan: EditorPlan,
  confirmEdits: boolean,
  session?: ToolSessionState,
  autoApprovePolicy?: AutoApprovePolicy
): Promise<{ summary: string; results: ToolResult[] }> {
  const actions = plan.actions ?? [];
  if (actions.length === 0) {
    return { summary: 'No file actions requested.', results: [] };
  }

  const results: ToolResult[] = [];
  for (const action of actions) {
    if (action.arguments && typeof action.arguments === 'object') {
      const pathArg = getFirstStringArg(action.arguments, ['path', 'file', 'filePath', 'filename']);
      if (pathArg) {
        const resolved = await resolveWorkspaceUri(pathArg, true);
        if (!resolved.uri && session?.lastWritePath) {
          const lastBase = path.basename(session.lastWritePath);
          const pathBase = path.basename(pathArg);
          if (lastBase === pathBase) {
            (action.arguments as Record<string, unknown>).path = session.lastWritePath;
          }
        }
      } else if (session?.lastWritePath) {
        if (['replace_lines', 'apply_patch'].includes(action.name)) {
          (action.arguments as Record<string, unknown>).path = session.lastWritePath;
        }
      }
    }
    const result = await runToolCall(panel, action, confirmEdits, session, autoApprovePolicy);
    results.push(result);
  }

  const applied = results.filter(r => r.ok && r.approved !== false);
  const rejected = results.filter(r => r.ok && r.approved === false);
  const failed = results.filter(r => !r.ok);
  const summaryParts: string[] = [];

  if (applied.length > 0) {
    summaryParts.push(`Applied ${applied.length} action(s).`);
  }
  if (rejected.length > 0) {
    summaryParts.push(`Rejected ${rejected.length} action(s).`);
  }
  if (failed.length > 0) {
    const details = failed
      .slice(0, 3)
      .map(item => `${item.tool}: ${item.message ?? 'error'}`)
      .join('; ');
    summaryParts.push(`Failed ${failed.length} action(s): ${details}`);
  }

  const lastWrite = session?.lastWritePath;
  if (lastWrite) {
    summaryParts.push(`Last write: ${formatDisplayPath(lastWrite)}`);
  }

  return { summary: summaryParts.join(' '), results };
}

async function generateEditorFirstResponse(
  panel: WebviewWrapper,
  baseUrl: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  timeout: number,
  maxIterations: number,
  confirmEdits: boolean,
  fallbackModel?: string,
  abortSignal?: AbortSignal,
  session?: ToolSessionState,
  autoApprovePolicy?: AutoApprovePolicy
): Promise<string> {
  const iterations = clampNumber(maxIterations, 3, 1, 6);
  const workingMessages = messages.map(m => ({ ...m }));
  const editorState = buildEditorStateMessage(session);
  if (editorState) {
    workingMessages.push({ role: 'system', content: editorState });
  }
  let currentModel = model;
  let switchedToFallback = false;

  for (let i = 0; i < iterations; i++) {
    if (abortSignal?.aborted) {
      const abortErr = new Error('AbortError');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    let response: string;
    try {
      response = await executeModelCallWithMessages(
        baseUrl,
        currentModel,
        systemPrompt,
        workingMessages,
        timeout,
        abortSignal,
        true
      );
    } catch (err) {
      if (fallbackModel && !switchedToFallback && currentModel !== fallbackModel) {
        outputChannel?.appendLine(`[EditorFirst] Model failed, switching to fallback: ${fallbackModel}`);
        currentModel = fallbackModel;
        switchedToFallback = true;
        continue;
      }
      throw err;
    }

    const parsed = parseEditorPlanResponse(response);
    if (!parsed.plan) {
      workingMessages.push({
        role: 'system',
        content: [
          'Invalid response format.',
          'Return a single JSON object only (no markdown).',
          'Schema: {"answer":"...","actions":[{"name":"write_file","arguments":{"path":"...","text":"..."}}]}'
        ].join('\n')
      });
      if (fallbackModel && !switchedToFallback && currentModel !== fallbackModel) {
        outputChannel?.appendLine(`[EditorFirst] Switching to fallback model: ${fallbackModel}`);
        currentModel = fallbackModel;
        switchedToFallback = true;
      }
      continue;
    }

    const plan = parsed.plan;
    const { summary, results } = await applyEditorPlan(panel, plan, confirmEdits, session, autoApprovePolicy);
    const answer = sanitizeEditorAnswer(plan.answer || '', results);
    const notesRaw = plan.notes && plan.notes.length > 0 ? plan.notes.join('\n') : '';
    const notes = notesRaw ? sanitizeEditorAnswer(notesRaw, results) : '';
    const responseParts = [answer, notes, summary].filter(part => part && part.trim());
    return responseParts.join('\n\n') || 'Hotovo.';
  }

  return 'Chyba: model nevratil platny JSON plan.';
}



function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getFirstStringArg(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function formatTimestampForName(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function sanitizeFileName(input: string): string {
  const ascii = input.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
  const cleaned = ascii.replace(/[/\\?%*:|"<>]/g, '-').trim();
  const collapsed = cleaned.replace(/\s+/g, '-').replace(/-+/g, '-');
  const trimmed = collapsed.replace(/^\.+/, '').replace(/\.+$/, '');
  return trimmed.slice(0, 120);
}

function normalizeExtension(ext: string | undefined): string {
  if (!ext) return '';
  const cleaned = ext.trim().toLowerCase();
  if (!cleaned) return '';
  const withDot = cleaned.startsWith('.') ? cleaned : `.${cleaned}`;
  return withDot.replace(/[^a-z0-9.]/g, '');
}

function extractExtensionFromName(name: string | undefined): string {
  if (!name) return '';
  return normalizeExtension(path.extname(name));
}

function inferExtensionFromTitle(title: string | undefined): string {
  if (!title) return '';
  const t = title.toLowerCase();
  if (t.includes('arduino') || t.includes('neopixel') || t.includes('.ino')) return '.ino';
  if (t.includes('markdown') || t.includes('.md')) return '.md';
  if (t.includes('typescript') || t.includes('.ts')) return '.ts';
  if (t.includes('javascript') || t.includes('.js')) return '.js';
  if (t.includes('json')) return '.json';
  if (t.includes('yaml') || t.includes('.yml') || t.includes('.yaml')) return '.yaml';
  if (t.includes('html')) return '.html';
  if (t.includes('css')) return '.css';
  if (t.includes('cpp') || t.includes('c++')) return '.cpp';
  if (t.includes('c ')) return '.c';
  if (t.includes('python') || t.includes('.py')) return '.py';
  return '';
}

function inferExtensionFromContent(content: string | undefined): string {
  if (!content) return '';
  const sample = content.slice(0, 2000).trim();
  if (!sample) return '';
  const lower = sample.toLowerCase();
  if (lower.startsWith('{') || lower.startsWith('[')) return '.json';
  const firstLine = sample.split(/\r\n|\n/, 1)[0]?.trim() ?? '';
  if (firstLine.startsWith('#')) return '.md';
  if (lower.includes('<!doctype html') || lower.includes('<html')) return '.html';
  if (lower.includes('<?xml')) return '.xml';
  if (lower.includes('void setup(') || lower.includes('void loop(')) return '.ino';
  if (lower.includes('adafruit_neopixel') || lower.includes('neopixel')) return '.ino';
  return '';
}

function inferNameFromContent(content: string | undefined): string {
  if (!content) return '';
  const lines = content.split(/\r\n|\n/).slice(0, 30);
  let inFrontMatter = false;
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) continue;
    if (i === 0 && line === '---') {
      inFrontMatter = true;
      continue;
    }
    if (inFrontMatter) {
      if (line === '---') {
        inFrontMatter = false;
        continue;
      }
      const match = line.match(/^title:\s*(.+)$/i);
      if (match) {
        const cleaned = match[1].replace(/^["']|["']$/g, '');
        return sanitizeFileName(cleaned);
      }
      continue;
    }
    if (line.startsWith('#')) {
      return sanitizeFileName(line.replace(/^#+\s*/, ''));
    }
    if (line.startsWith('//')) {
      return sanitizeFileName(line.replace(/^\/\/+\s*/, ''));
    }
    if (line.startsWith('/*')) {
      return sanitizeFileName(line.replace(/^\/\*\s*/, '').replace(/\*\/.*/, ''));
    }
    const match = line.match(/^(?:export\s+)?(?:class|function|interface|type)\s+([A-Za-z0-9_]+)/);
    if (match) {
      return sanitizeFileName(match[1]);
    }
  }
  return '';
}

function buildAutoFileName(options: {
  title?: string;
  suggestedName?: string;
  extension?: string;
  content?: string;
}): string {
  const title = options.title;
  const suggestedNameRaw = options.suggestedName;
  const extensionRaw = options.extension;
  const content = options.content;
  const extFromSuggested = extractExtensionFromName(suggestedNameRaw);
  const extFromTitle = inferExtensionFromTitle(title);
  const extFromContent = inferExtensionFromContent(content);
  let extension = normalizeExtension(extensionRaw || extFromSuggested || extFromTitle || extFromContent);
  if (!extension) extension = '.txt';

  let baseName = '';
  if (suggestedNameRaw) {
    baseName = sanitizeFileName(path.parse(suggestedNameRaw).name);
  } else if (title) {
    baseName = sanitizeFileName(title);
  } else if (content) {
    baseName = inferNameFromContent(content);
  }
  if (!baseName) baseName = 'shumilek-output';

  let fileName = baseName;
  if (baseName === 'shumilek-output') {
    fileName = `${baseName}-${formatTimestampForName()}`;
  }
  return `${fileName}${extension}`;
}

function normalizeRouteText(input: string): string {
  return input.normalize('NFKD').replace(/[^\x00-\x7F]/g, '').toLowerCase();
}

function tokenizeRouteText(input: string): string[] {
  const cleaned = normalizeRouteText(input).replace(/[^a-z0-9_.-]+/g, ' ');
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.filter(part => part.length >= 2);
}

function computeContentHash(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function isBinaryExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function isProbablyBinary(buffer: Uint8Array): boolean {
  let suspicious = 0;
  const total = buffer.length;
  if (total === 0) return false;
  for (let i = 0; i < total; i++) {
    const byte = buffer[i];
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) {
      suspicious++;
    }
  }
  return (suspicious / total) > 0.3;
}

async function readFileForTool(
  uri: vscode.Uri,
  maxBytes: number
): Promise<{ text?: string; size?: number; hash?: string; error?: string; binary?: boolean }> {
  if (isBinaryExtension(uri.fsPath)) {
    return { error: 'soubor vypada jako binarni (extenze)', binary: true };
  }

  const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === uri.fsPath);
  if (openDoc) {
    const text = openDoc.getText();
    const size = Buffer.byteLength(text, 'utf8');
    if (size > maxBytes) {
      return { error: `soubor je moc velky (${size} bytes), limit ${maxBytes}`, size };
    }
    return { text, size, hash: computeContentHash(text) };
  }

  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.size > maxBytes) {
    return { error: `soubor je moc velky (${stat.size} bytes), limit ${maxBytes}`, size: stat.size };
  }

  const buffer = await vscode.workspace.fs.readFile(uri);
  if (isProbablyBinary(buffer)) {
    return { error: 'soubor vypada jako binarni (obsah)', binary: true, size: buffer.length };
  }
  const text = new TextDecoder().decode(buffer);
  return { text, size: buffer.length, hash: computeContentHash(text) };
}

function isWithinWorkspace(uri: vscode.Uri): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return false;
  const target = path.resolve(uri.fsPath);
  return folders.some(folder => {
    const root = path.resolve(folder.uri.fsPath);
    return target === root || target.startsWith(root + path.sep);
  });
}

function sanitizeRelativePath(input: string | undefined, fallback: string): string {
  if (!input) return fallback;
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  if (path.isAbsolute(trimmed)) return fallback;
  const normalized = path.normalize(trimmed);
  const segments = normalized.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0 || segments.some(segment => segment === '..')) return fallback;
  return segments.join(path.sep);
}

function normalizePathToken(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function isWorkspaceRootSegment(segment: string, folders: ReadonlyArray<vscode.WorkspaceFolder>): boolean {
  const segNorm = normalizePathToken(segment);
  if (!segNorm) return false;
  for (const folder of folders) {
    const names = [folder.name, path.basename(folder.uri.fsPath)];
    for (const name of names) {
      const nameNorm = normalizePathToken(name);
      if (!nameNorm) continue;
      if (segNorm === nameNorm) return true;
      if (segNorm.startsWith(nameNorm) || nameNorm.startsWith(segNorm)) return true;
    }
  }
  return false;
}

function normalizeAutoSaveDir(raw: string, folder?: vscode.WorkspaceFolder): string {
  const cleaned = sanitizeRelativePath(raw, 'out');
  const segments = cleaned.split(/[\\/]+/).filter(Boolean);
  const folders = vscode.workspace.workspaceFolders ?? [];
  while (segments.length > 0 && folders.length > 0 && isWorkspaceRootSegment(segments[0], folders)) {
    segments.shift();
  }
  const normalized = segments.join(path.sep);
  return normalized || 'out';
}

function getToolsAutoSaveDir(): string {
  const config = vscode.workspace.getConfiguration('shumilek');
  const raw = config.get<string>('toolsAutoSaveDir', 'out');
  const folder = getWorkspaceFolderForAutoSave();
  return normalizeAutoSaveDir(raw, folder);
}

function getProjectMapPath(): string {
  const config = vscode.workspace.getConfiguration('shumilek');
  return sanitizeRelativePath(config.get<string>('projectMapPath', 'PROJECT_MAP.md'), 'PROJECT_MAP.md');
}

function getProjectMapCachePath(): string {
  const config = vscode.workspace.getConfiguration('shumilek');
  const fallback = path.join(getToolsAutoSaveDir(), 'project_map.json');
  return sanitizeRelativePath(config.get<string>('projectMapCachePath', fallback), fallback);
}

function getProjectMapAutoUpdateSetting(): boolean {
  return vscode.workspace.getConfiguration('shumilek').get<boolean>('projectMapAutoUpdate', true);
}

function getWorkspaceFolderForProjectMap(preferredUri?: vscode.Uri): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  if (preferredUri) {
    const preferredFolder = vscode.workspace.getWorkspaceFolder(preferredUri);
    if (preferredFolder) return preferredFolder;
  }
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const activeFolder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (activeFolder) return activeFolder;
  }
  return folders[0];
}

function sanitizeMapSegment(value: string): string {
  const cleaned = value.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
  const normalized = cleaned.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || 'root';
}

function getProjectMapPathsForFolder(folder: vscode.WorkspaceFolder): { mapPath: string; cachePath: string } {
  const mapPath = getProjectMapPath();
  const cachePath = getProjectMapCachePath();
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length <= 1) {
    return { mapPath, cachePath };
  }

  const suffix = sanitizeMapSegment(folder.name);
  const mapParsed = path.parse(mapPath);
  const mapFile = `${mapParsed.name}.${suffix}${mapParsed.ext || '.md'}`;
  const cacheParsed = path.parse(cachePath);
  const cacheFile = `${cacheParsed.name}.${suffix}${cacheParsed.ext || '.json'}`;

  const mapPathWithSuffix = path.join(mapParsed.dir, mapFile);
  const cachePathWithSuffix = path.join(cacheParsed.dir, cacheFile);

  return {
    mapPath: sanitizeRelativePath(mapPathWithSuffix, mapPath),
    cachePath: sanitizeRelativePath(cachePathWithSuffix, cachePath)
  };
}

function formatProjectMapMarkdown(map: ProjectMap): string {
  const lines: string[] = [];
  lines.push('# Project Map');
  lines.push(`Updated: ${new Date(map.lastUpdated).toISOString()}`);
  lines.push('');
  lines.push('## Tree');
  lines.push(map.tree ? map.tree : '- (empty)');
  lines.push('');
  lines.push('## Key Files');
  if (map.keyFiles.length === 0) {
    lines.push('- (none)');
  } else {
    for (const file of map.keyFiles) {
      lines.push(`- ${file}`);
    }
  }
  lines.push('');
  lines.push('## Modules');
  if (map.modules.length === 0) {
    lines.push('- (none)');
  } else {
    for (const mod of map.modules) {
      lines.push(`- ${mod.name}: ${mod.summary}`);
      for (const file of mod.files) {
        lines.push(`  - ${file}`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

async function writeProjectMapFiles(
  map: ProjectMap,
  folderOverride?: vscode.WorkspaceFolder
): Promise<{ mdUri?: vscode.Uri; jsonUri?: vscode.Uri; error?: string }> {
  const folder = folderOverride ?? getWorkspaceFolderForProjectMap();
  if (!folder) return { error: 'workspace not open' };
  const markdown = formatProjectMapMarkdown(map);
  const json = JSON.stringify(map, null, 2);

  const paths = getProjectMapPathsForFolder(folder);
  const mapPath = paths.mapPath;
  const mapDir = path.dirname(mapPath);
  if (mapDir && mapDir !== '.') {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, mapDir));
  }
  const mapUri = vscode.Uri.joinPath(folder.uri, mapPath);
  await vscode.workspace.fs.writeFile(mapUri, Buffer.from(markdown, 'utf8'));

  const cachePath = paths.cachePath;
  const cacheDir = path.dirname(cachePath);
  if (cacheDir && cacheDir !== '.') {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, cacheDir));
  }
  const cacheUri = vscode.Uri.joinPath(folder.uri, cachePath);
  await vscode.workspace.fs.writeFile(cacheUri, Buffer.from(json, 'utf8'));

  return { mdUri: mapUri, jsonUri: cacheUri };
}

async function ensureProjectMap(
  context: vscode.ExtensionContext,
  reason: string,
  preferredUri?: vscode.Uri,
  force: boolean = false
): Promise<ProjectMap | null> {
  if (!force && !getProjectMapAutoUpdateSetting()) return null;
  let index = workspaceIndexer.getIndex();
  if (!index) {
    await workspaceIndexer.scanWorkspace();
    index = workspaceIndexer.getIndex();
  }
  const map = workspaceIndexer.getProjectMap();
  if (!map) return null;
  await context.workspaceState.update('projectMapCache', map);
  try {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length > 1) {
      if (preferredUri) {
        const folder = getWorkspaceFolderForProjectMap(preferredUri);
        if (folder) {
          const mapForFolder = workspaceIndexer.getProjectMapForFolder(folder) ?? map;
          await writeProjectMapFiles(mapForFolder, folder);
        }
      } else {
        for (const folder of folders) {
          const mapForFolder = workspaceIndexer.getProjectMapForFolder(folder) ?? map;
          await writeProjectMapFiles(mapForFolder, folder);
        }
      }
    } else {
      await writeProjectMapFiles(map, getWorkspaceFolderForProjectMap(preferredUri));
    }
    outputChannel?.appendLine(`[ProjectMap] Updated (${reason})`);
  } catch (err) {
    outputChannel?.appendLine(`[ProjectMap] Write failed: ${String(err)}`);
  }
  return map;
}

function scheduleProjectMapUpdate(
  context: vscode.ExtensionContext,
  reason: string,
  preferredUri?: vscode.Uri
): void {
  if (!getProjectMapAutoUpdateSetting()) return;
  if (projectMapUpdateTimer) clearTimeout(projectMapUpdateTimer);
  projectMapUpdateTimer = setTimeout(() => {
    void ensureProjectMap(context, reason, preferredUri);
  }, 800);
}

function getActiveWorkspaceFileUri(): vscode.Uri | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const uri = editor.document.uri;
  if (!isWithinWorkspace(uri)) return undefined;
  return uri;
}

function getWorkspaceFolderForAutoSave(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const activeFolder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (activeFolder) return activeFolder;
  }
  return folders[0];
}

function isInAutoSaveDir(uri: vscode.Uri): boolean {
  const folder = getWorkspaceFolderForAutoSave();
  if (!folder) return false;
  const autoSaveDir = getToolsAutoSaveDir();
  const autoSaveRoot = path.resolve(folder.uri.fsPath, autoSaveDir);
  const target = path.resolve(uri.fsPath);
  return target === autoSaveRoot || target.startsWith(autoSaveRoot + path.sep);
}

function isFileNotFoundError(err: unknown): boolean {
  if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') return true;
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code?: string }).code === 'FileNotFound';
  }
  return false;
}

async function ensureUniqueFileUri(folderUri: vscode.Uri, fileName: string): Promise<vscode.Uri> {
  const parsed = path.parse(fileName);
  let candidateName = fileName;
  let counter = 1;
  while (true) {
    const candidateUri = vscode.Uri.joinPath(folderUri, candidateName);
    try {
      await vscode.workspace.fs.stat(candidateUri);
    } catch (err) {
      if (isFileNotFoundError(err)) {
        return candidateUri;
      }
      throw err;
    }
    candidateName = `${parsed.name}-${counter}${parsed.ext}`;
    counter++;
    if (counter > 1000) return candidateUri;
  }
}

async function resolveAutoSaveTargetUri(fileName: string): Promise<{ uri?: vscode.Uri; error?: string }> {
  const folder = getWorkspaceFolderForAutoSave();
  if (!folder) return { error: 'workspace neni otevreny' };

  const autoSaveDir = getToolsAutoSaveDir();
  const autoSaveFolder = vscode.Uri.joinPath(folder.uri, autoSaveDir);
  await vscode.workspace.fs.createDirectory(autoSaveFolder);
  const uniqueUri = await ensureUniqueFileUri(autoSaveFolder, fileName);
  return { uri: uniqueUri };
}

function decodePathInput(input: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(input)) return input;
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

async function resolveWorkspaceUri(
  inputPath: string,
  mustExist: boolean
): Promise<{ uri?: vscode.Uri; error?: string; conflicts?: string[] }> {
  if (!inputPath) return { error: 'path je povinny' };
  const trimmed = inputPath.trim();
  if (!trimmed) return { error: 'path je prazdny' };
  const cleaned = decodePathInput(trimmed);
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return { error: 'workspace neni otevreny' };

  const tryUri = async (uri: vscode.Uri): Promise<{ uri?: vscode.Uri; error?: string }> => {
    if (!isWithinWorkspace(uri)) return { error: 'soubor je mimo workspace' };
    if (mustExist) {
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        return { error: 'soubor neexistuje' };
      }
    }
    return { uri };
  };

  if (path.isAbsolute(cleaned)) {
    return await tryUri(vscode.Uri.file(cleaned));
  }

  const multiRoot = folders.length > 1;
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  const rootCandidate = parts[0];
  const rest = parts.slice(1).join('/');

  if (multiRoot && rootCandidate) {
    const matchedRoot = folders.find(folder => {
      const rootName = folder.name;
      const baseName = path.basename(folder.uri.fsPath);
      return rootCandidate === rootName || rootCandidate === baseName;
    });
    if (matchedRoot) {
      if (!rest) {
        return { error: 'uved root, ale chybi cesta k souboru' };
      }
      return await tryUri(vscode.Uri.joinPath(matchedRoot.uri, rest));
    }
  }

  if (mustExist) {
    const matches: vscode.Uri[] = [];
    for (const folder of folders) {
      const candidate = vscode.Uri.joinPath(folder.uri, cleaned);
      const resolved = await tryUri(candidate);
      if (resolved.uri) {
        matches.push(resolved.uri);
      }
    }

    if (matches.length === 1) return { uri: matches[0] };
    if (matches.length > 1) {
      return {
        error: 'soubor je ve vice workspacich, upresni root',
        conflicts: matches.map(uri => getRelativePathForWorkspace(uri))
      };
    }

    const pattern = `**/${cleaned.replace(/\\/g, '/')}`;
    const fallbackMatches = await vscode.workspace.findFiles(pattern, DEFAULT_EXCLUDE_GLOB, 3);
    if (fallbackMatches.length === 1) return { uri: fallbackMatches[0] };
    if (fallbackMatches.length > 1) {
      return {
        error: 'soubor je ve vice workspacich, upresni root',
        conflicts: fallbackMatches.map(uri => getRelativePathForWorkspace(uri))
      };
    }

    return { error: 'soubor nenalezen' };
  }

  if (multiRoot) {
    return {
      error: 'vice workspace rootu, upresni cestu jako root/soubor',
      conflicts: folders.map(folder => folder.name)
    };
  }

  return await tryUri(vscode.Uri.joinPath(folders[0].uri, cleaned));
}

function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function splitLines(text: string): string[] {
  if (!text) return [''];
  return text.split(/\r\n|\n/);
}

function truncateTextByBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return { text, truncated: false };
  }
  let end = Math.min(text.length, maxBytes);
  let slice = text.slice(0, end);
  while (Buffer.byteLength(slice, 'utf8') > maxBytes && end > 0) {
    end--;
    slice = text.slice(0, end);
  }
  return { text: slice, truncated: true };
}

async function readFileFromDisk(
  uri: vscode.Uri,
  maxBytes: number
): Promise<{ text?: string; size?: number; error?: string; binary?: boolean }> {
  if (isBinaryExtension(uri.fsPath)) {
    return { error: 'binary file extension', binary: true };
  }
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > maxBytes) {
      return { error: `file too large (${stat.size} bytes)`, size: stat.size };
    }
    const buffer = await vscode.workspace.fs.readFile(uri);
    if (isProbablyBinary(buffer)) {
      return { error: 'binary file content', binary: true, size: buffer.length };
    }
    const text = new TextDecoder().decode(buffer);
    return { text, size: buffer.length };
  } catch (err) {
    if (isFileNotFoundError(err)) {
      return { error: 'file not found' };
    }
    return { error: `read error: ${String(err)}` };
  }
}

function buildSimpleDiff(
  oldText: string,
  newText: string,
  maxLines: number
): { diff: string; truncated: boolean } {
  if (oldText === newText) return { diff: '', truncated: false };
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  const context = 2;
  const contextStart = Math.max(0, start - context);
  const contextEndOld = Math.min(oldLines.length - 1, oldEnd + context);
  const contextEndNew = Math.min(newLines.length - 1, newEnd + context);
  const hunkHeader = `@@ -${contextStart + 1},${contextEndOld - contextStart + 1} +${contextStart + 1},${contextEndNew - contextStart + 1} @@`;
  const lines: string[] = [hunkHeader];

  for (let i = contextStart; i < start; i++) {
    lines.push(` ${oldLines[i] ?? ''}`);
  }
  for (let i = start; i <= oldEnd; i++) {
    if (i < 0 || i >= oldLines.length) break;
    lines.push(`-${oldLines[i]}`);
  }
  for (let i = start; i <= newEnd; i++) {
    if (i < 0 || i >= newLines.length) break;
    lines.push(`+${newLines[i]}`);
  }
  for (let i = oldEnd + 1; i <= contextEndOld; i++) {
    if (i < 0 || i >= oldLines.length) break;
    lines.push(` ${oldLines[i] ?? ''}`);
  }

  let truncated = false;
  if (lines.length > maxLines) {
    truncated = true;
    lines.length = maxLines;
    lines.push('... truncated');
  }
  return { diff: lines.join('\n'), truncated };
}

function getOpenTextDocuments(): vscode.TextDocument[] {
  const seen = new Set<string>();
  const docs: vscode.TextDocument[] = [];
  const active = vscode.window.activeTextEditor?.document;
  if (active && !seen.has(active.uri.toString())) {
    seen.add(active.uri.toString());
    docs.push(active);
  }
  for (const editor of vscode.window.visibleTextEditors) {
    const doc = editor.document;
    const key = doc.uri.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    docs.push(doc);
  }
  return docs;
}

function extractImportPaths(text: string): string[] {
  const paths = new Set<string>();
  const importRegex = /from\s+['"]([^'"]+)['"]/g;
  const requireRegex = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(text)) !== null) {
    if (match[1]) paths.add(match[1]);
  }
  while ((match = requireRegex.exec(text)) !== null) {
    if (match[1]) paths.add(match[1]);
  }
  return Array.from(paths);
}

async function resolveImportToUri(
  baseUri: vscode.Uri,
  importPath: string
): Promise<vscode.Uri | undefined> {
  if (!importPath.startsWith('.')) return undefined;
  const baseDir = vscode.Uri.joinPath(baseUri, '..');
  const candidateBase = vscode.Uri.joinPath(baseDir, importPath);
  const candidates = [
    candidateBase,
    vscode.Uri.file(`${candidateBase.fsPath}.ts`),
    vscode.Uri.file(`${candidateBase.fsPath}.tsx`),
    vscode.Uri.file(`${candidateBase.fsPath}.js`),
    vscode.Uri.file(`${candidateBase.fsPath}.json`),
    vscode.Uri.joinPath(candidateBase, 'index.ts'),
    vscode.Uri.joinPath(candidateBase, 'index.tsx'),
    vscode.Uri.joinPath(candidateBase, 'index.js')
  ];
  for (const uri of candidates) {
    try {
      await vscode.workspace.fs.stat(uri);
      if (isWithinWorkspace(uri)) return uri;
    } catch {
      // ignore
    }
  }
  return undefined;
}

function isTestFileName(name: string): boolean {
  return /\.test\./i.test(name) || /\.spec\./i.test(name);
}

async function findRelatedTestFiles(doc: vscode.TextDocument, maxResults: number): Promise<vscode.Uri[]> {
  const baseName = path.parse(doc.uri.fsPath).name;
  const index = workspaceIndexer.getIndex();
  const results: vscode.Uri[] = [];
  if (index) {
    for (const file of index.files) {
      if (!isTestFileName(file.name)) continue;
      if (!file.name.toLowerCase().includes(baseName.toLowerCase())) continue;
      results.push(vscode.Uri.file(file.path));
      if (results.length >= maxResults) break;
    }
  }
  return results;
}

async function findFallbackRelatedFiles(
  doc: vscode.TextDocument,
  maxResults: number
): Promise<vscode.Uri[]> {
  const baseName = path.parse(doc.uri.fsPath).name;
  const patterns = [
    `**/*${baseName}.test.*`,
    `**/*${baseName}.spec.*`,
    `**/${baseName}.*`,
    `**/*${baseName}*.*`
  ];
  const results: vscode.Uri[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const found = await vscode.workspace.findFiles(pattern, DEFAULT_EXCLUDE_GLOB, maxResults);
    for (const uri of found) {
      if (!isWithinWorkspace(uri)) continue;
      if (uri.fsPath === doc.uri.fsPath) continue;
      if (seen.has(uri.fsPath)) continue;
      seen.add(uri.fsPath);
      results.push(uri);
      if (results.length >= maxResults) return results;
    }
  }
  return results;
}

async function buildWarmContext(doc: vscode.TextDocument): Promise<string[]> {
  const lines: string[] = [];
  const rawText = doc.getText();
  const importPaths = extractImportPaths(rawText).slice(0, DEFAULT_MAX_WARM_FILES);
  const importUris: vscode.Uri[] = [];
  for (const imp of importPaths) {
    const uri = await resolveImportToUri(doc.uri, imp);
    if (uri) importUris.push(uri);
  }
  const testUris = await findRelatedTestFiles(doc, 2);
  let relatedUris = [...importUris, ...testUris].slice(0, DEFAULT_MAX_WARM_FILES);
  if (relatedUris.length === 0) {
    const fallback = await findFallbackRelatedFiles(doc, DEFAULT_MAX_WARM_FALLBACK_RESULTS);
    relatedUris = fallback.slice(0, DEFAULT_MAX_WARM_FILES);
  }

  if (relatedUris.length === 0) {
    lines.push('WARM_CONTEXT: none');
    return lines;
  }

  lines.push('WARM_CONTEXT: related files');
  for (const uri of relatedUris) {
    const label = getRelativePathForWorkspace(uri);
    const readResult = await readFileFromDisk(uri, DEFAULT_MAX_WARM_FILE_BYTES);
    if (readResult.text === undefined) {
      lines.push(`- ${label}: ${readResult.error ?? 'unavailable'}`);
      continue;
    }
    const truncated = truncateTextByBytes(readResult.text, DEFAULT_MAX_WARM_FILE_BYTES);
    lines.push(`FILE: ${label}`);
    lines.push('```');
    lines.push(truncated.text);
    lines.push('```');
    if (truncated.truncated) lines.push('NOTE: truncated');
  }

  return lines;
}

async function buildLspContext(doc: vscode.TextDocument): Promise<string[]> {
  const lines: string[] = [];
  const editor = vscode.window.activeTextEditor;
  if (!editor) return lines;
  const position = editor.selection.active;
  const diagnostics = vscode.languages.getDiagnostics(doc.uri).slice(0, DEFAULT_MAX_LSP_DIAGNOSTICS);
  if (diagnostics.length > 0) {
    lines.push('LSP_DIAGNOSTICS:');
    for (const diag of diagnostics) {
      const range = serializeRange(diag.range);
      lines.push(`- ${serializeDiagnosticSeverity(diag.severity)}: ${diag.message} (${range.startLine}:${range.startCharacter})`);
    }
  }

  const defs = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink> | vscode.Location | undefined>(
    'vscode.executeDefinitionProvider',
    doc.uri,
    position
  );
  const defList = Array.isArray(defs) ? defs : (defs ? [defs] : []);
  if (defList.length > 0) {
    lines.push('LSP_DEFINITION:');
    for (const def of defList.slice(0, 3)) {
      const info = serializeLocationInfo(def);
      lines.push(`- ${info.path}:${info.range.startLine}:${info.range.startCharacter}`);
    }
  }

  const refs = await vscode.commands.executeCommand<vscode.Location[]>(
    'vscode.executeReferenceProvider',
    doc.uri,
    position,
    { includeDeclaration: true }
  );
  const refList = (refs ?? []).slice(0, DEFAULT_MAX_LSP_REFERENCES);
  if (refList.length > 0) {
    lines.push(`LSP_REFERENCES: ${refList.length}`);
    for (const ref of refList.slice(0, 5)) {
      const info = serializeLocationInfo(ref);
      lines.push(`- ${info.path}:${info.range.startLine}:${info.range.startCharacter}`);
    }
  }

  return lines;
}

function buildColdContext(includeMap: boolean, preferredUri?: vscode.Uri): string[] {
  if (!includeMap) return ['COLD_CONTEXT: skipped'];
  const folder = preferredUri ? vscode.workspace.getWorkspaceFolder(preferredUri) : undefined;
  const map = folder
    ? workspaceIndexer.getProjectMapForFolder(folder) ?? workspaceIndexer.getProjectMap()
    : workspaceIndexer.getProjectMap();
  if (!map) return ['COLD_CONTEXT: no project map'];
  const lines: string[] = [];
  lines.push('COLD_CONTEXT: project map');
  lines.push('TREE:');
  lines.push(map.tree ? map.tree : '- (empty)');
  if (map.keyFiles.length > 0) {
    lines.push('KEY_FILES:');
    for (const file of map.keyFiles.slice(0, 20)) {
      lines.push(`- ${file}`);
    }
  }
  return lines;
}

async function buildEditorContext(
  prompt: string,
  context: vscode.ExtensionContext,
  workspaceIndexEnabled: boolean,
  preferredMapUri?: vscode.Uri
): Promise<string> {
  const lines: string[] = [];
  const activeUri = getActiveWorkspaceFileUri();
  const includeMap = !activeUri || /(map|overview|structure|arch|projekt|repo)/i.test(prompt);
  lines.push('EDITOR_CONTEXT');
  lines.push('CONTEXT_ZONES: hot, warm, cold');
  lines.push(`active_file: ${activeUri ? getRelativePathForWorkspace(activeUri) : 'none'}`);

  const openDocs = getOpenTextDocuments().slice(0, DEFAULT_MAX_EDITOR_FILES);
  lines.push(`open_files: ${openDocs.length}`);
  let remainingBytes = DEFAULT_MAX_EDITOR_TOTAL_BYTES;

  for (const doc of openDocs) {
    const pathLabel = isWithinWorkspace(doc.uri)
      ? getRelativePathForWorkspace(doc.uri)
      : doc.uri.fsPath;
    lines.push(`- ${pathLabel} (lang=${doc.languageId}, lines=${doc.lineCount}, dirty=${doc.isDirty})`);
  }

  for (const doc of openDocs) {
    if (remainingBytes <= 0) break;
    const pathLabel = isWithinWorkspace(doc.uri)
      ? getRelativePathForWorkspace(doc.uri)
      : doc.uri.fsPath;
    const rawText = doc.getText();
    const maxBytes = Math.min(DEFAULT_MAX_EDITOR_FILE_BYTES, remainingBytes);
    const truncated = truncateTextByBytes(rawText, maxBytes);
    remainingBytes -= Buffer.byteLength(truncated.text, 'utf8');

    lines.push(`FILE: ${pathLabel}`);
    lines.push('```');
    lines.push(truncated.text);
    lines.push('```');
    if (truncated.truncated) {
      lines.push('NOTE: file content truncated');
    }

    if (doc.isDirty && doc.uri.scheme === 'file') {
      const diskResult = await readFileFromDisk(doc.uri, DEFAULT_MAX_DIFF_BYTES);
      if (diskResult.text !== undefined) {
        const diff = buildSimpleDiff(diskResult.text, rawText, DEFAULT_MAX_DIFF_LINES);
        if (diff.diff) {
          lines.push(`DIFF: ${pathLabel}`);
          lines.push('```');
          lines.push(diff.diff);
          lines.push('```');
          if (diff.truncated) {
            lines.push('NOTE: diff truncated');
          }
        }
      } else {
        lines.push(`DIFF: ${pathLabel}`);
        lines.push('```');
        lines.push('+ (no saved version)');
        lines.push('```');
      }
    }
  }

  if (activeUri) {
    const activeDoc = openDocs.find(doc => doc.uri.fsPath === activeUri.fsPath) ?? await vscode.workspace.openTextDocument(activeUri);
    lines.push(...await buildWarmContext(activeDoc));
    lines.push(...await buildLspContext(activeDoc));
  } else {
    lines.push('WARM_CONTEXT: no active file');
  }
  if (includeMap && workspaceIndexEnabled && !workspaceIndexer.getProjectMap()) {
    await ensureProjectMap(context, 'on-demand', preferredMapUri, true);
  }
  lines.push(...buildColdContext(includeMap, activeUri));

  return lines.join('\n');
}

function buildEditorFirstInstructions(): string {
  return [
    'EDITOR-FIRST MODE:',
    'Return a single JSON object only (no markdown, no tool_call tags).',
    'Schema:',
    '{"answer":"...", "actions":[{"name":"replace_lines","arguments":{"path":"...","startLine":1,"endLine":1,"text":"...","expected":"..."}}]}',
    'Prefer patch-first edits when possible.',
    'Actions supported: apply_patch, write_file, replace_lines, rename_file, delete_file.',
    'apply_patch expects unified diff in arguments.diff.',
    'Use 1-based line numbers for replace_lines.',
    'If you are unsure about path, omit it and provide suggestedName/extension for write_file.',
    'No extra keys are required. Do not include analysis or commentary.'
  ].join('\n');
}

function serializeRange(range: vscode.Range): RangeInfo {
  return {
    startLine: range.start.line + 1,
    startCharacter: range.start.character + 1,
    endLine: range.end.line + 1,
    endCharacter: range.end.character + 1
  };
}

function serializeSymbolKind(kind: vscode.SymbolKind): string {
  const label = (vscode.SymbolKind as Record<number, string>)[kind];
  return label ?? String(kind);
}

function getPositionFromArgs(
  args: Record<string, unknown>,
  doc?: vscode.TextDocument
): { position?: vscode.Position; line?: number; character?: number; error?: string } {
  const rawLine = typeof args.line === 'number'
    ? args.line
    : (typeof args.lineNumber === 'number'
      ? args.lineNumber
      : (args.position && typeof args.position === 'object' && typeof (args.position as any).line === 'number'
        ? (args.position as any).line
        : undefined));
  const rawChar = typeof args.character === 'number'
    ? args.character
    : (typeof args.column === 'number'
      ? args.column
      : (args.position && typeof args.position === 'object' && typeof (args.position as any).character === 'number'
        ? (args.position as any).character
        : undefined));
  if (typeof rawLine !== 'number' || typeof rawChar !== 'number') {
    return { error: 'line a character jsou povinne' };
  }
  const line = Math.max(1, Math.floor(rawLine));
  const character = Math.max(1, Math.floor(rawChar));
  if (doc) {
    const clampedLine = clampNumber(line, 1, 1, doc.lineCount || 1);
    const lineText = doc.lineAt(clampedLine - 1).text;
    const clampedChar = clampNumber(character, 1, 1, Math.max(1, lineText.length + 1));
    return {
      position: new vscode.Position(clampedLine - 1, clampedChar - 1),
      line: clampedLine,
      character: clampedChar
    };
  }
  return {
    position: new vscode.Position(line - 1, character - 1),
    line,
    character
  };
}

function serializeLocationInfo(location: vscode.Location | vscode.LocationLink): { path: string; range: RangeInfo } {
  const uri = 'targetUri' in location ? location.targetUri : location.uri;
  const range = 'targetRange' in location ? location.targetRange : location.range;
  return {
    path: getRelativePathForWorkspace(uri),
    range: serializeRange(range)
  };
}

function renderHoverContents(
  contents:
  | vscode.MarkedString
  | vscode.MarkedString[]
  | vscode.MarkdownString
  | vscode.MarkdownString[]
  | Array<vscode.MarkedString | vscode.MarkdownString>
): string[] {
  const list = Array.isArray(contents) ? contents : [contents];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      out.push(item);
    } else if (item && typeof item === 'object') {
      const anyItem = item as { value?: string; language?: string };
      if (typeof anyItem.value === 'string') {
        out.push(anyItem.value);
      } else if ('value' in item) {
        out.push(String((item as any).value));
      } else {
        out.push(String(item));
      }
    }
  }
  return out;
}

function serializeDiagnosticSeverity(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'Error';
    case vscode.DiagnosticSeverity.Warning:
      return 'Warning';
    case vscode.DiagnosticSeverity.Information:
      return 'Information';
    case vscode.DiagnosticSeverity.Hint:
      return 'Hint';
    default:
      return String(severity);
  }
}

function collectDocumentSymbols(
  symbols: vscode.DocumentSymbol[],
  maxDepth: number,
  maxResults: number
): { symbols: Array<Record<string, unknown>>; total: number; truncated: boolean } {
  let count = 0;
  let truncated = false;
  const walk = (symbol: vscode.DocumentSymbol, depth: number): Record<string, unknown> | null => {
    if (count >= maxResults) {
      truncated = true;
      return null;
    }
    count++;
    const node: Record<string, unknown> = {
      name: symbol.name,
      kind: serializeSymbolKind(symbol.kind),
      detail: symbol.detail,
      range: serializeRange(symbol.range),
      selectionRange: serializeRange(symbol.selectionRange)
    };
    if (symbol.children && symbol.children.length > 0 && depth < maxDepth) {
      const children: Array<Record<string, unknown>> = [];
      for (const child of symbol.children) {
        const childNode = walk(child, depth + 1);
        if (childNode) children.push(childNode);
      }
      node.children = children;
    }
    return node;
  };
  const result: Array<Record<string, unknown>> = [];
  for (const symbol of symbols) {
    const node = walk(symbol, 0);
    if (node) result.push(node);
  }
  return { symbols: result, total: count, truncated };
}

function collectSymbolInformation(
  symbols: vscode.SymbolInformation[],
  maxResults: number
): { symbols: Array<Record<string, unknown>>; total: number; truncated: boolean } {
  const result: Array<Record<string, unknown>> = [];
  let count = 0;
  for (const symbol of symbols) {
    if (count >= maxResults) break;
    count++;
    result.push({
      name: symbol.name,
      kind: serializeSymbolKind(symbol.kind),
      containerName: symbol.containerName,
      range: serializeRange(symbol.location.range)
    });
  }
  return { symbols: result, total: count, truncated: count >= maxResults };
}

async function resolveSymbolPosition(
  uri: vscode.Uri,
  symbolName: string
): Promise<vscode.Position | undefined> {
  const docSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | vscode.SymbolInformation[]>(
    'vscode.executeDocumentSymbolProvider',
    uri
  );
  if (!docSymbols || docSymbols.length === 0) return undefined;
  const lower = symbolName.toLowerCase();
  if ('location' in (docSymbols[0] as any)) {
    const infoSymbols = docSymbols as vscode.SymbolInformation[];
    const match = infoSymbols.find(sym => sym.name.toLowerCase() === lower) ?? infoSymbols[0];
    return match.location.range.start;
  }
  const walk = (symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol | undefined => {
    let first: vscode.DocumentSymbol | undefined;
    for (const symbol of symbols) {
      if (!first) first = symbol;
      if (symbol.name.toLowerCase() === lower) return symbol;
      if (symbol.children && symbol.children.length > 0) {
        const found = walk(symbol.children);
        if (found) return found;
      }
    }
    return first;
  };
  const match = walk(docSymbols as vscode.DocumentSymbol[]);
  return match?.selectionRange.start;
}

function getFullDocumentRange(doc: vscode.TextDocument): vscode.Range {
  if (doc.lineCount === 0) {
    return new vscode.Range(0, 0, 0, 0);
  }
  const lastLine = doc.lineAt(doc.lineCount - 1);
  return new vscode.Range(0, 0, doc.lineCount - 1, lastLine.text.length);
}

function markToolMutation(session: ToolSessionState | undefined, toolName: string): void {
  if (!session) return;
  session.hadMutations = true;
  if (!session.mutationTools.includes(toolName)) {
    session.mutationTools.push(toolName);
  }
}

function getRelativePathForWorkspace(uri: vscode.Uri): string {
  const folders = vscode.workspace.workspaceFolders;
  const includeRoot = Boolean(folders && folders.length > 1);
  return vscode.workspace.asRelativePath(uri, includeRoot);
}

function recordToolWrite(
  session: ToolSessionState | undefined,
  action: 'created' | 'updated',
  relativePath: string
): void {
  if (!session) return;
  session.lastWriteAction = action;
  session.lastWritePath = relativePath;
  lastToolWriteAction = action;
  lastToolWritePath = relativePath;
}

async function showDiffAndConfirm(uri: vscode.Uri, newText: string, title: string): Promise<boolean> {
  const originalDoc = await vscode.workspace.openTextDocument(uri);
  const previewDoc = await vscode.workspace.openTextDocument({
    content: newText,
    language: originalDoc.languageId
  });
  await vscode.commands.executeCommand('vscode.diff', uri, previewDoc.uri, title);
  const choice = await vscode.window.showInformationMessage(
    'Pouzit navrzene zmeny?',
    { modal: true },
    'Pouzit',
    'Zamitnout'
  );
  return choice === 'Pouzit';
}

async function applyFileContent(uri: vscode.Uri, newText: string): Promise<boolean> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, getFullDocumentRange(doc), newText);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) return false;
  return await doc.save();
}

interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

interface PatchFile {
  oldPath?: string;
  newPath?: string;
  hunks: PatchHunk[];
}

function normalizePatchPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '/dev/null') return '';
  return trimmed.replace(/^a\//, '').replace(/^b\//, '');
}

function parseUnifiedDiff(diffText: string): PatchFile[] {
  const lines = diffText.split(/\r\n|\n/);
  const files: PatchFile[] = [];
  let currentFile: PatchFile | null = null;
  let currentHunk: PatchHunk | null = null;

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      continue;
    }
    if (line.startsWith('--- ')) {
      if (currentFile) files.push(currentFile);
      currentFile = { oldPath: normalizePatchPath(line.slice(4)), newPath: undefined, hunks: [] };
      currentHunk = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (!currentFile) {
        currentFile = { oldPath: undefined, newPath: normalizePatchPath(line.slice(4)), hunks: [] };
      } else {
        currentFile.newPath = normalizePatchPath(line.slice(4));
      }
      continue;
    }
    if (line.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match || !currentFile) continue;
      const oldStart = parseInt(match[1], 10);
      const oldLines = match[2] ? parseInt(match[2], 10) : 1;
      const newStart = parseInt(match[3], 10);
      const newLines = match[4] ? parseInt(match[4], 10) : 1;
      currentHunk = { oldStart, oldLines, newStart, newLines, lines: [] };
      currentFile.hunks.push(currentHunk);
      continue;
    }
    if (currentHunk && (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line.startsWith('\\'))) {
      currentHunk.lines.push(line);
    }
  }
  if (currentFile) files.push(currentFile);
  return files;
}

function applyUnifiedDiffToText(
  original: string,
  hunks: PatchHunk[]
): { text?: string; error?: string; appliedHunks: number; totalHunks: number } {
  const eol = detectEol(original);
  const originalLines = original.length === 0 ? [] : splitLines(original);
  const result: string[] = [];
  let cursor = 0;
  let appliedHunks = 0;
  const totalHunks = hunks.length;

  for (const hunk of hunks) {
    const oldStartIndex = Math.max(0, hunk.oldStart - 1);
    if (oldStartIndex < cursor || oldStartIndex > originalLines.length) {
      return { error: 'hunk start out of range', appliedHunks, totalHunks };
    }
    result.push(...originalLines.slice(cursor, oldStartIndex));
    let index = oldStartIndex;

    for (const line of hunk.lines) {
      if (!line) continue;
      const prefix = line[0];
      if (prefix === '\\') continue;
      const content = line.slice(1);
      if (prefix === ' ') {
        if (originalLines[index] !== content) {
          return { error: 'context mismatch', appliedHunks, totalHunks };
        }
        result.push(content);
        index++;
      } else if (prefix === '-') {
        if (originalLines[index] !== content) {
          return { error: 'delete mismatch', appliedHunks, totalHunks };
        }
        index++;
      } else if (prefix === '+') {
        result.push(content);
      }
    }
    cursor = index;
    appliedHunks++;
  }

  result.push(...originalLines.slice(cursor));
  return { text: result.join(eol), appliedHunks, totalHunks };
}

const READ_TOOL_NAMES = new Set<string>([
  'list_files',
  'read_file',
  'get_active_file',
  'search_in_files',
  'get_symbols',
  'get_workspace_symbols',
  'get_definition',
  'get_references',
  'get_type_info',
  'get_diagnostics',
  'pick_file_for_intent',
  'pick_save_path'
]);

const EDIT_TOOL_NAMES = new Set<string>([
  'apply_patch',
  'replace_lines',
  'write_file',
  'rename_file',
  'delete_file'
]);

function resolveToolPermissionScope(name: string): keyof AutoApprovePolicy {
  if (EDIT_TOOL_NAMES.has(name)) return 'edit';
  if (READ_TOOL_NAMES.has(name)) return 'read';
  if (name.startsWith('browser_')) return 'browser';
  if (name.startsWith('mcp_')) return 'mcp';
  return 'commands';
}

async function runToolCall(
  panel: WebviewWrapper,
  call: ToolCall,
  confirmEdits: boolean,
  session?: ToolSessionState,
  autoApprovePolicy?: AutoApprovePolicy
): Promise<ToolResult> {
  const name = call.name;
  const args = call.arguments || {};
  const autoApprove = autoApprovePolicy ?? {
    read: true,
    edit: false,
    commands: false,
    browser: false,
    mcp: false
  };

  outputChannel?.appendLine(`[Tools] ${name}`);
  postToAllWebviews({ type: 'toolEvent', name });
  const permissionScope = resolveToolPermissionScope(name);
  if (confirmEdits && permissionScope !== 'edit' && !autoApprove[permissionScope]) {
    const choice = await vscode.window.showInformationMessage(
      `Povolit akci "${name}" (scope: ${permissionScope})?`,
      { modal: true },
      'Povolit',
      'Zamitnout'
    );
    if (choice !== 'Povolit') {
      return { ok: true, tool: name, approved: false, message: `akce zamitnuta (scope: ${permissionScope})` };
    }
  }
  if (panel && panel.visible) {
    panel.webview.postMessage({
      type: 'pipelineStatus',
      icon: PIPELINE_STATUS_ICONS.tools,
      text: `Tool: ${name}`,
      statusType: 'step',
      loading: true
    });
  }

  try {
    switch (name) {
      case 'list_files': {
        const glob = asString(args.glob) ?? '**/*';
        const maxResults = clampNumber(args.maxResults, DEFAULT_MAX_LIST_RESULTS, 1, 1000);
        const files = await vscode.workspace.findFiles(glob, DEFAULT_EXCLUDE_GLOB, maxResults);
        return {
          ok: true,
          tool: name,
          data: { files: files.map(uri => getRelativePathForWorkspace(uri)) }
        };
      }
      case 'read_file': {
        const filePath = asString(args.path);
        let uri: vscode.Uri | undefined;
        if (filePath) {
          const resolved = await resolveWorkspaceUri(filePath, true);
          if (!resolved.uri) {
            return {
              ok: false,
              tool: name,
              message: resolved.error ?? 'soubor nenalezen nebo mimo workspace',
              data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
            };
          }
          uri = resolved.uri;
        } else {
          const activeUri = getActiveWorkspaceFileUri();
          if (!activeUri) {
            return { ok: false, tool: name, message: 'path je povinny nebo otevri aktivni soubor' };
          }
          uri = activeUri;
        }
        const readResult = await readFileForTool(uri, DEFAULT_MAX_READ_BYTES);
        if (readResult.text === undefined) {
          return {
            ok: false,
            tool: name,
            message: readResult.error ?? 'soubor nelze precist',
            data: {
              sizeBytes: readResult.size,
              binary: readResult.binary ?? false
            }
          };
        }
        const lines = splitLines(readResult.text);
        const totalLines = lines.length;
        let startLine = clampNumber(args.startLine, 1, 1, totalLines || 1);
        let endLine = clampNumber(args.endLine, totalLines || 1, startLine, totalLines || 1);
        let truncated = false;
        if (endLine - startLine + 1 > DEFAULT_MAX_READ_LINES) {
          endLine = startLine + DEFAULT_MAX_READ_LINES - 1;
          truncated = true;
        }
        const eol = detectEol(readResult.text);
        const content = lines.slice(startLine - 1, endLine).join(eol);
        if (readResult.hash) {
          lastReadHashes.set(uri.fsPath, { hash: readResult.hash, updatedAt: Date.now() });
        }
        return {
          ok: true,
          tool: name,
          message: truncated ? 'obsah zkracen' : undefined,
          data: {
            path: getRelativePathForWorkspace(uri),
            startLine,
            endLine,
            totalLines,
            sizeBytes: readResult.size,
            hash: readResult.hash,
            content
          }
        };
      }
      case 'get_active_file': {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return { ok: false, tool: name, message: 'zadny aktivni editor' };
        const doc = editor.document;
        if (isBinaryExtension(doc.fileName)) {
          return { ok: false, tool: name, message: 'soubor vypada jako binarni (extenze)', data: { binary: true } };
        }
        const text = doc.getText();
        const size = Buffer.byteLength(text, 'utf8');
        if (size > DEFAULT_MAX_READ_BYTES) {
          return { ok: false, tool: name, message: `soubor je moc velky (${size} bytes), limit ${DEFAULT_MAX_READ_BYTES}`, data: { sizeBytes: size } };
        }
        const lines = splitLines(text);
        const totalLines = lines.length;
        const eol = detectEol(text);
        const endLine = Math.min(totalLines || 1, DEFAULT_MAX_READ_LINES);
        const content = lines.slice(0, endLine).join(eol);
        const hash = computeContentHash(text);
        lastReadHashes.set(doc.uri.fsPath, { hash, updatedAt: Date.now() });
        return {
          ok: true,
          tool: name,
          data: {
            path: getRelativePathForWorkspace(doc.uri),
            startLine: 1,
            endLine,
            totalLines,
            sizeBytes: size,
            hash,
            content
          }
        };
      }
      case 'search_in_files': {
        const query = asString(args.query);
        if (!query) return { ok: false, tool: name, message: 'query je povinny' };
        const glob = asString(args.glob);
        const maxResults = clampNumber(args.maxResults, DEFAULT_MAX_SEARCH_RESULTS, 1, 200);
        const matches: Array<{ path: string; line: number; text: string }> = [];
        const include = glob ?? '**/*';
        const maxFilesToScan = Math.min(500, Math.max(50, maxResults * 25));
        const files = await vscode.workspace.findFiles(include, DEFAULT_EXCLUDE_GLOB, maxFilesToScan);
        let skippedBinary = 0;
        let skippedLarge = 0;

        for (const uri of files) {
          if (matches.length >= maxResults) break;
          const readResult = await readFileForTool(uri, DEFAULT_MAX_READ_BYTES);
          if (readResult.text === undefined) {
            if (readResult.binary) skippedBinary++;
            if (readResult.size && readResult.size > DEFAULT_MAX_READ_BYTES) skippedLarge++;
            continue;
          }

          const lines = splitLines(readResult.text);
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= maxResults) break;
            const lineText = lines[i];
            if (lineText.includes(query)) {
              matches.push({
                path: getRelativePathForWorkspace(uri),
                line: i + 1,
                text: lineText.trim()
              });
            }
          }
        }
        return {
          ok: true,
          tool: name,
          data: {
            matches,
            scannedFiles: files.length,
            skippedBinary,
            skippedLarge
          }
        };
      }
      case 'apply_patch': {
        const diffText = getFirstStringArg(args, ['diff', 'patch', 'text', 'content']);
        if (!diffText) return { ok: false, tool: name, message: 'diff je povinny' };
        const patches = parseUnifiedDiff(diffText);
        if (patches.length === 0) {
          return { ok: false, tool: name, message: 'neplatny diff' };
        }
        const autoOpenAutoSave = getToolsAutoOpenAutoSaveSetting();
        const autoOpenOnWrite = getToolsAutoOpenOnWriteSetting();
        const appliedFiles: Array<{ path: string; action: 'created' | 'updated' | 'deleted'; hunksApplied: number; hunksTotal: number }> = [];

        for (const patch of patches) {
          const targetPath = patch.newPath || patch.oldPath;
          if (!targetPath) continue;
          const isDelete = Boolean(patch.oldPath) && !patch.newPath;
          if (isBinaryExtension(targetPath)) {
            return { ok: false, tool: name, message: 'cesta vypada jako binarni soubor (extenze)' };
          }
          const resolved = await resolveWorkspaceUri(targetPath, !isDelete);
          if (!resolved.uri) {
            const data: Record<string, unknown> = {};
            if (resolved.conflicts) data.conflicts = resolved.conflicts;
            if (appliedFiles.length > 0) data.appliedFiles = appliedFiles;
            return {
              ok: false,
              tool: name,
              message: resolved.error ?? 'soubor mimo workspace',
              data: Object.keys(data).length > 0 ? data : undefined
            };
          }
          const uri = resolved.uri;
          let exists = true;
          try {
            await vscode.workspace.fs.stat(uri);
          } catch {
            exists = false;
          }

          let originalText = '';
          if (exists) {
            const readResult = await readFileForTool(uri, DEFAULT_MAX_WRITE_BYTES);
            if (readResult.text === undefined) {
              const data: Record<string, unknown> = {
                sizeBytes: readResult.size,
                binary: readResult.binary ?? false
              };
              if (appliedFiles.length > 0) data.appliedFiles = appliedFiles;
              return {
                ok: false,
                tool: name,
                message: readResult.error ?? 'soubor nelze precist',
                data
              };
            }
            originalText = readResult.text;
          }

          const applied = applyUnifiedDiffToText(originalText, patch.hunks);
          if (applied.text === undefined) {
            return {
              ok: false,
              tool: name,
              message: applied.error ?? 'nelze aplikovat diff',
              data: {
                path: getRelativePathForWorkspace(uri),
                appliedHunks: applied.appliedHunks,
                totalHunks: applied.totalHunks,
                appliedFiles
              }
            };
          }

          let approved = true;
          if (confirmEdits && !autoApprove.edit) {
            if (exists) {
              approved = await showDiffAndConfirm(uri, applied.text, `Navrh zmen: ${vscode.workspace.asRelativePath(uri)}`);
            } else {
              const previewDoc = await vscode.workspace.openTextDocument({ content: applied.text });
              await vscode.window.showTextDocument(previewDoc, { preview: true });
              const choice = await vscode.window.showInformationMessage(
                `Vytvorit novy soubor ${vscode.workspace.asRelativePath(uri)}?`,
                { modal: true },
                'Vytvorit',
                'Zamitnout'
              );
              approved = choice === 'Vytvorit';
            }
          }

          if (!approved) {
            return { ok: true, tool: name, approved: false, message: 'zmena zamitnuta uzivatelem' };
          }

          if (isDelete) {
            await vscode.workspace.fs.delete(uri, { recursive: false });
            markToolMutation(session, name);
            appliedFiles.push({
              path: getRelativePathForWorkspace(uri),
              action: 'deleted',
              hunksApplied: applied.appliedHunks,
              hunksTotal: applied.totalHunks
            });
            continue;
          }

          if (exists) {
            const appliedOk = await applyFileContent(uri, applied.text);
            if (!appliedOk) {
              const data = appliedFiles.length > 0 ? { appliedFiles } : undefined;
              return { ok: false, tool: name, message: 'nepodarilo se aplikovat diff', data };
            }
            const relativePath = getRelativePathForWorkspace(uri);
            markToolMutation(session, name);
            recordToolWrite(session, 'updated', relativePath);
            lastReadHashes.set(uri.fsPath, { hash: computeContentHash(applied.text), updatedAt: Date.now() });
            const shouldOpenUpdated = autoOpenOnWrite || (autoOpenAutoSave && isInAutoSaveDir(uri));
            if (shouldOpenUpdated) {
              await revealWrittenDocument(uri);
            }
            await notifyToolWrite('updated', uri);
            appliedFiles.push({
              path: relativePath,
              action: 'updated',
              hunksApplied: applied.appliedHunks,
              hunksTotal: applied.totalHunks
            });
          } else {
            const parent = vscode.Uri.file(path.dirname(uri.fsPath));
            await vscode.workspace.fs.createDirectory(parent);
            await vscode.workspace.fs.writeFile(uri, Buffer.from(applied.text, 'utf8'));
            const shouldOpenCreated = autoOpenOnWrite || (autoOpenAutoSave && isInAutoSaveDir(uri));
            if (shouldOpenCreated) {
              const opened = await vscode.workspace.openTextDocument(uri);
              await vscode.window.showTextDocument(opened, { preview: false });
            }
            await notifyToolWrite('created', uri);
            const createdPath = getRelativePathForWorkspace(uri);
            markToolMutation(session, name);
            recordToolWrite(session, 'created', createdPath);
            lastReadHashes.set(uri.fsPath, { hash: computeContentHash(applied.text), updatedAt: Date.now() });
            appliedFiles.push({
              path: createdPath,
              action: 'created',
              hunksApplied: applied.appliedHunks,
              hunksTotal: applied.totalHunks
            });
          }
        }

        return {
          ok: true,
          tool: name,
          approved: true,
          message: 'diff aplikovan',
          data: { files: appliedFiles }
        };
      }
      case 'get_symbols': {
        const filePath = getFirstStringArg(args, ['path', 'file', 'filePath', 'filename']);
        let uri: vscode.Uri | undefined;
        if (filePath) {
          const resolved = await resolveWorkspaceUri(filePath, true);
          if (!resolved.uri) {
            return {
              ok: false,
              tool: name,
              message: resolved.error ?? 'soubor nenalezen nebo mimo workspace',
              data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
            };
          }
          uri = resolved.uri;
        } else {
          const activeUri = getActiveWorkspaceFileUri();
          if (!activeUri) {
            return { ok: false, tool: name, message: 'path je povinny nebo otevri aktivni soubor' };
          }
          uri = activeUri;
        }

        const maxResults = clampNumber(args.maxResults, DEFAULT_MAX_LSP_RESULTS, 1, 1000);
        const maxDepth = clampNumber(args.maxDepth, 3, 0, 10);
        const symbols = await vscode.commands.executeCommand<
          Array<vscode.DocumentSymbol> | Array<vscode.SymbolInformation> | undefined
        >('vscode.executeDocumentSymbolProvider', uri);
        const relativePath = getRelativePathForWorkspace(uri);

        if (!symbols || symbols.length === 0) {
          return { ok: true, tool: name, data: { path: relativePath, symbols: [], total: 0 } };
        }

        const first = symbols[0] as any;
        const payload = 'location' in first
          ? collectSymbolInformation(symbols as vscode.SymbolInformation[], maxResults)
          : collectDocumentSymbols(symbols as vscode.DocumentSymbol[], maxDepth, maxResults);

        return {
          ok: true,
          tool: name,
          data: {
            path: relativePath,
            maxDepth,
            ...payload
          }
        };
      }
      case 'get_workspace_symbols': {
        const query = asString(args.query) ?? '';
        const maxResults = clampNumber(args.maxResults, DEFAULT_MAX_LSP_RESULTS, 1, 1000);
        const symbols = await vscode.commands.executeCommand<
          Array<vscode.SymbolInformation> | undefined
        >('vscode.executeWorkspaceSymbolProvider', query);
        if (!symbols || symbols.length === 0) {
          return { ok: true, tool: name, data: { query, symbols: [], total: 0 } };
        }
        const results: Array<Record<string, unknown>> = [];
        for (const symbol of symbols) {
          if (results.length >= maxResults) break;
          const location = (symbol as any).location as vscode.Location | vscode.LocationLink | undefined;
          results.push({
            name: symbol.name,
            kind: serializeSymbolKind(symbol.kind),
            containerName: (symbol as any).containerName,
            location: location ? serializeLocationInfo(location) : undefined
          });
        }
        return {
          ok: true,
          tool: name,
          data: {
            query,
            symbols: results,
            total: symbols.length,
            truncated: symbols.length > maxResults
          }
        };
      }
      case 'get_definition': {
        const filePath = getFirstStringArg(args, ['path', 'file', 'filePath', 'filename']);
        let uri: vscode.Uri | undefined;
        if (filePath) {
          const resolved = await resolveWorkspaceUri(filePath, true);
          if (!resolved.uri) {
            return {
              ok: false,
              tool: name,
              message: resolved.error ?? 'soubor nenalezen nebo mimo workspace',
              data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
            };
          }
          uri = resolved.uri;
        } else {
          const activeUri = getActiveWorkspaceFileUri();
          if (!activeUri) {
            return { ok: false, tool: name, message: 'path je povinny nebo otevri aktivni soubor' };
          }
          uri = activeUri;
        }

        const doc = await vscode.workspace.openTextDocument(uri);
        const symbolName = asString(args.symbol);
        let posInfo = getPositionFromArgs(args, doc);
        let position = posInfo.position;
        if (!position && symbolName) {
          position = await resolveSymbolPosition(uri, symbolName);
          if (position) {
            posInfo = { position, line: position.line + 1, character: position.character + 1 };
          }
        }
        if (!position) {
          return { ok: false, tool: name, message: posInfo.error ?? 'pozice nenalezena' };
        }

        const definitions = await vscode.commands.executeCommand<
          Array<vscode.Location | vscode.LocationLink> | vscode.Location | undefined
        >('vscode.executeDefinitionProvider', uri, position);
        const list = Array.isArray(definitions) ? definitions : (definitions ? [definitions] : []);
        const maxResults = clampNumber(args.maxResults, DEFAULT_MAX_LSP_RESULTS, 1, 1000);
        const results = list.slice(0, maxResults).map(loc => serializeLocationInfo(loc));

        return {
          ok: true,
          tool: name,
          data: {
            path: getRelativePathForWorkspace(uri),
            position: { line: posInfo.line ?? position.line + 1, character: posInfo.character ?? position.character + 1 },
            definitions: results,
            total: list.length,
            truncated: list.length > maxResults
          }
        };
      }
      case 'get_references': {
        const filePath = getFirstStringArg(args, ['path', 'file', 'filePath', 'filename']);
        let uri: vscode.Uri | undefined;
        if (filePath) {
          const resolved = await resolveWorkspaceUri(filePath, true);
          if (!resolved.uri) {
            return {
              ok: false,
              tool: name,
              message: resolved.error ?? 'soubor nenalezen nebo mimo workspace',
              data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
            };
          }
          uri = resolved.uri;
        } else {
          const activeUri = getActiveWorkspaceFileUri();
          if (!activeUri) {
            return { ok: false, tool: name, message: 'path je povinny nebo otevri aktivni soubor' };
          }
          uri = activeUri;
        }

        const doc = await vscode.workspace.openTextDocument(uri);
        const posInfo = getPositionFromArgs(args, doc);
        if (!posInfo.position) {
          return { ok: false, tool: name, message: posInfo.error ?? 'pozice nenalezena' };
        }
        const includeDeclaration = typeof args.includeDeclaration === 'boolean' ? args.includeDeclaration : false;
        const references = await vscode.commands.executeCommand<vscode.Location[]>(
          'vscode.executeReferenceProvider',
          uri,
          posInfo.position,
          { includeDeclaration }
        );
        const list = references ?? [];
        const maxResults = clampNumber(args.maxResults, DEFAULT_MAX_LSP_RESULTS, 1, 1000);
        const results = list.slice(0, maxResults).map(loc => serializeLocationInfo(loc));
        return {
          ok: true,
          tool: name,
          data: {
            path: getRelativePathForWorkspace(uri),
            position: { line: posInfo.line ?? posInfo.position.line + 1, character: posInfo.character ?? posInfo.position.character + 1 },
            includeDeclaration,
            references: results,
            total: list.length,
            truncated: list.length > maxResults
          }
        };
      }
      case 'get_type_info': {
        const filePath = getFirstStringArg(args, ['path', 'file', 'filePath', 'filename']);
        let uri: vscode.Uri | undefined;
        if (filePath) {
          const resolved = await resolveWorkspaceUri(filePath, true);
          if (!resolved.uri) {
            return {
              ok: false,
              tool: name,
              message: resolved.error ?? 'soubor nenalezen nebo mimo workspace',
              data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
            };
          }
          uri = resolved.uri;
        } else {
          const activeUri = getActiveWorkspaceFileUri();
          if (!activeUri) {
            return { ok: false, tool: name, message: 'path je povinny nebo otevri aktivni soubor' };
          }
          uri = activeUri;
        }

        const doc = await vscode.workspace.openTextDocument(uri);
        const posInfo = getPositionFromArgs(args, doc);
        if (!posInfo.position) {
          return { ok: false, tool: name, message: posInfo.error ?? 'pozice nenalezena' };
        }
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
          'vscode.executeHoverProvider',
          uri,
          posInfo.position
        );
        const list = hovers ?? [];
        const maxResults = clampNumber(args.maxResults, DEFAULT_MAX_LSP_RESULTS, 1, 1000);
        const results = list.slice(0, maxResults).map(hover => ({
          range: hover.range ? serializeRange(hover.range) : undefined,
          contents: renderHoverContents(hover.contents)
        }));
        return {
          ok: true,
          tool: name,
          data: {
            path: getRelativePathForWorkspace(uri),
            position: { line: posInfo.line ?? posInfo.position.line + 1, character: posInfo.character ?? posInfo.position.character + 1 },
            hovers: results,
            total: list.length,
            truncated: list.length > maxResults
          }
        };
      }
      case 'get_diagnostics': {
        const filePath = getFirstStringArg(args, ['path', 'file', 'filePath', 'filename']);
        const maxResults = clampNumber(args.maxResults, DEFAULT_MAX_LSP_RESULTS, 1, 1000);
        const results: Array<Record<string, unknown>> = [];
        let total = 0;
        if (filePath) {
          const resolved = await resolveWorkspaceUri(filePath, true);
          if (!resolved.uri) {
            return {
              ok: false,
              tool: name,
              message: resolved.error ?? 'soubor nenalezen nebo mimo workspace',
              data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
            };
          }
          const uri = resolved.uri;
          const diagnostics = vscode.languages.getDiagnostics(uri);
          total = diagnostics.length;
          for (const diag of diagnostics) {
            if (results.length >= maxResults) break;
            results.push({
              path: getRelativePathForWorkspace(uri),
              severity: serializeDiagnosticSeverity(diag.severity),
              message: diag.message,
              range: serializeRange(diag.range),
              source: diag.source,
              code: typeof diag.code === 'object' ? (diag.code as any).value : diag.code
            });
          }
        } else {
          const allDiagnostics = vscode.languages.getDiagnostics();
          for (const [uri, diagnostics] of allDiagnostics) {
            total += diagnostics.length;
            for (const diag of diagnostics) {
              if (results.length >= maxResults) break;
              results.push({
                path: getRelativePathForWorkspace(uri),
                severity: serializeDiagnosticSeverity(diag.severity),
                message: diag.message,
                range: serializeRange(diag.range),
                source: diag.source,
                code: typeof diag.code === 'object' ? (diag.code as any).value : diag.code
              });
            }
            if (results.length >= maxResults) break;
          }
        }
        return {
          ok: true,
          tool: name,
          data: {
            diagnostics: results,
            total,
            truncated: total > maxResults
          }
        };
      }
      case 'route_file': {
        const intent = asString(args.intent);
        if (!intent) return { ok: false, tool: name, message: 'intent je povinny' };
        const preferredExtension = normalizeExtension(asString(args.preferredExtension));
        const fileNameHint = asString(args.fileNameHint) ?? asString(args.suggestedName);
        const maxResults = clampNumber(args.maxResults, 5, 1, 15);
        const glob = asString(args.glob) ?? '**/*';
        const allowCreate = typeof args.allowCreate === 'boolean' ? args.allowCreate : true;
        const maxFilesToScan = Math.min(2000, Math.max(200, maxResults * 200));
        const files = await vscode.workspace.findFiles(glob, DEFAULT_EXCLUDE_GLOB, maxFilesToScan);
        const activeUri = getActiveWorkspaceFileUri();
        const tokens = tokenizeRouteText([intent, fileNameHint].filter(Boolean).join(' '));
        const hintName = fileNameHint
          ? normalizeRouteText(path.parse(fileNameHint).name)
          : '';
        const candidates: Array<{ path: string; score: number; reason: string }> = [];

        for (const uri of files) {
          const relPath = getRelativePathForWorkspace(uri);
          const lowerPath = normalizeRouteText(relPath);
          const ext = path.extname(relPath).toLowerCase();
          if (BINARY_EXTENSIONS.has(ext)) continue;
          const baseName = path.basename(lowerPath);
          let score = 0;
          const reasons: string[] = [];

          if (preferredExtension && ext === preferredExtension) {
            score += 6;
            reasons.push('ext');
          }
          if (hintName) {
            if (baseName === `${hintName}${ext}`) {
              score += 10;
              reasons.push('hint-exact');
            } else if (baseName.includes(hintName)) {
              score += 6;
              reasons.push('hint-base');
            } else if (lowerPath.includes(hintName)) {
              score += 3;
              reasons.push('hint-path');
            }
          }

          let matchedTokens = 0;
          for (const token of tokens) {
            if (baseName.includes(token)) {
              score += 2;
              matchedTokens++;
            } else if (lowerPath.includes(token)) {
              score += 1;
              matchedTokens++;
            }
          }
          if (matchedTokens > 0) {
            reasons.push(`tokens:${matchedTokens}`);
          }

          if (activeUri && uri.fsPath === activeUri.fsPath) {
            score += 2;
            reasons.push('active');
          }

          if (score > 0) {
            candidates.push({
              path: relPath,
              score,
              reason: reasons.join('+') || 'match'
            });
          }
        }

        candidates.sort((a, b) => b.score - a.score);
        const topCandidates = candidates.slice(0, maxResults);
        let bestPath = topCandidates[0]?.path;
        let autoSavePath: string | undefined;

        if (!bestPath && activeUri) {
          bestPath = getRelativePathForWorkspace(activeUri);
        }

        if (!bestPath && allowCreate) {
          const fileName = buildAutoFileName({
            title: intent,
            suggestedName: fileNameHint,
            extension: preferredExtension
          });
          const resolved = await resolveAutoSaveTargetUri(fileName);
          if (resolved.uri) {
            autoSavePath = getRelativePathForWorkspace(resolved.uri);
            bestPath = autoSavePath;
          }
        }

        return {
          ok: true,
          tool: name,
          data: {
            bestPath,
            candidates: topCandidates,
            autoSavePath
          }
        };
      }
      case 'pick_save_path': {
        const title = asString(args.title);
        const suggestedNameRaw = asString(args.suggestedName);
        const extensionRaw = asString(args.extension);
        const fileName = buildAutoFileName({
          title,
          suggestedName: suggestedNameRaw,
          extension: extensionRaw
        });
        const resolved = await resolveAutoSaveTargetUri(fileName);
        if (!resolved.uri) {
          return { ok: false, tool: name, message: resolved.error ?? 'nelze vytvorit cestu' };
        }
        const uri = resolved.uri;

        return {
          ok: true,
          tool: name,
          data: {
            path: getRelativePathForWorkspace(uri),
            fileName: path.basename(uri.fsPath),
            folder: getRelativePathForWorkspace(vscode.Uri.file(path.dirname(uri.fsPath)))
          }
        };
      }
      case 'replace_lines': {
        const filePath = getFirstStringArg(args, ['path', 'file', 'filePath', 'filename']);
        const startLine = typeof args.startLine === 'number'
          ? args.startLine
          : (typeof args.start === 'number' ? args.start : NaN);
        const endLine = typeof args.endLine === 'number'
          ? args.endLine
          : (typeof args.end === 'number' ? args.end : NaN);
        const replacement = getFirstStringArg(args, ['text', 'replacement', 'content', 'body', 'value']);
        const expected = asString(args.expected);
        const autoOpenOnWrite = getToolsAutoOpenOnWriteSetting();
        const autoOpenAutoSave = getToolsAutoOpenAutoSaveSetting();

        if (replacement === undefined || !Number.isFinite(startLine) || !Number.isFinite(endLine)) {
          return { ok: false, tool: name, message: 'startLine, endLine, text jsou povinne' };
        }

        let uri: vscode.Uri | undefined;
        if (filePath) {
          const resolved = await resolveWorkspaceUri(filePath, true);
          if (!resolved.uri) {
            return {
              ok: false,
              tool: name,
              message: resolved.error ?? 'soubor nenalezen nebo mimo workspace',
              data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
            };
          }
          uri = resolved.uri;
        } else {
          const activeUri = getActiveWorkspaceFileUri();
          if (!activeUri) {
            return { ok: false, tool: name, message: 'path je povinny nebo otevri aktivni soubor' };
          }
          uri = activeUri;
        }

        const readResult = await readFileForTool(uri, DEFAULT_MAX_READ_BYTES);
        if (readResult.text === undefined) {
          return {
            ok: false,
            tool: name,
            message: readResult.error ?? 'soubor nelze precist',
            data: {
              sizeBytes: readResult.size,
              binary: readResult.binary ?? false
            }
          };
        }
        const lastHash = lastReadHashes.get(uri.fsPath);
        if (!lastHash && readResult.hash) {
          lastReadHashes.set(uri.fsPath, { hash: readResult.hash, updatedAt: Date.now() });
        } else if (readResult.hash && lastHash && lastHash.hash !== readResult.hash) {
          const currentLineCount = readResult.text ? readResult.text.split(/\r\n|\n/).length : undefined;
          return {
            ok: false,
            tool: name,
            message: 'soubor se zmenil od posledniho cteni; nacti ho znovu (read_file) a opakuj replace_lines',
            data: {
              path: getRelativePathForWorkspace(uri),
              lastHash: lastHash.hash,
              lastReadAt: lastHash.updatedAt,
              currentHash: readResult.hash,
              currentSizeBytes: readResult.size,
              currentLineCount
            }
          };
        }

        const eol = detectEol(readResult.text);
        const lines = splitLines(readResult.text);
        const totalLines = lines.length;
        if (startLine < 1 || endLine < startLine || startLine > totalLines) {
          return { ok: false, tool: name, message: 'neplatny rozsah radku' };
        }

        const currentBlock = lines.slice(startLine - 1, endLine).join('\n');
        if (expected && expected.replace(/\r\n/g, '\n') !== currentBlock) {
          return {
            ok: false,
            tool: name,
            message: 'expected neodpovida aktualnimu obsahu',
            data: { current: currentBlock }
          };
        }

        const replacementLines = replacement.split(/\r\n|\n/);
        const newLines = [
          ...lines.slice(0, startLine - 1),
          ...replacementLines,
          ...lines.slice(endLine)
        ];
        const newText = newLines.join(eol);

        let approved = true;
        if (confirmEdits && !autoApprove.edit) {
          approved = await showDiffAndConfirm(uri, newText, `Navrh zmen: ${vscode.workspace.asRelativePath(uri)}`);
        }
        if (!approved) {
          return { ok: true, tool: name, approved: false, message: 'zmena zamitnuta uzivatelem' };
        }

        const applied = await applyFileContent(uri, newText);
        if (applied) {
          const relativePath = getRelativePathForWorkspace(uri);
          markToolMutation(session, name);
          recordToolWrite(session, 'updated', relativePath);
          lastReadHashes.set(uri.fsPath, { hash: computeContentHash(newText), updatedAt: Date.now() });
          const shouldOpenUpdated = autoOpenOnWrite || (autoOpenAutoSave && isInAutoSaveDir(uri));
          if (shouldOpenUpdated) {
            await revealWrittenDocument(uri);
          }
          await notifyToolWrite('updated', uri);
        }
        return {
          ok: applied,
          tool: name,
          approved: applied,
          message: applied ? 'zmena aplikovana' : 'nepodarilo se aplikovat zmenu',
          data: applied ? { path: getRelativePathForWorkspace(uri), action: 'updated' } : undefined
        };
      }
      case 'write_file': {
        let filePath = getFirstStringArg(args, ['path', 'file', 'filePath', 'filename']);
        const text = getFirstStringArg(args, ['text', 'content', 'body', 'data', 'value']);
        const title = asString(args.title);
        const suggestedNameRaw = asString(args.suggestedName);
        const extensionRaw = asString(args.extension);
        const autoOpenAutoSave = getToolsAutoOpenAutoSaveSetting();
        const autoOpenOnWrite = getToolsAutoOpenOnWriteSetting();
        const hadExplicitPath = Boolean(filePath);
        let autoSaveGenerated = false;
        if (text === undefined) {
          return { ok: false, tool: name, message: 'text je povinny' };
        }
        const textBytes = Buffer.byteLength(text, 'utf8');
        if (textBytes > DEFAULT_MAX_WRITE_BYTES) {
          return {
            ok: false,
            tool: name,
            message: `obsah je moc velky (${textBytes} bytes), limit ${DEFAULT_MAX_WRITE_BYTES}`,
            data: { sizeBytes: textBytes }
          };
        }

        let uri: vscode.Uri | undefined;
        if (filePath) {
          if (isBinaryExtension(filePath)) {
            return { ok: false, tool: name, message: 'cesta vypada jako binarni soubor (extenze)' };
          }
          const resolved = await resolveWorkspaceUri(filePath, false);
          if (!resolved.uri) {
            return {
              ok: false,
              tool: name,
              message: resolved.error ?? 'soubor mimo workspace',
              data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
            };
          }
          uri = resolved.uri;
        } else {
          const activeUri = getActiveWorkspaceFileUri();
          if (activeUri) {
            if (isBinaryExtension(activeUri.fsPath)) {
              return { ok: false, tool: name, message: 'aktivni soubor vypada jako binarni (extenze)' };
            }
            uri = activeUri;
            filePath = getRelativePathForWorkspace(activeUri);
          } else {
            const fileName = buildAutoFileName({
              title,
              suggestedName: suggestedNameRaw,
              extension: extensionRaw,
              content: text
            });
            const resolved = await resolveAutoSaveTargetUri(fileName);
            if (!resolved.uri) {
              return { ok: false, tool: name, message: resolved.error ?? 'nelze vytvorit cestu' };
            }
            uri = resolved.uri;
            filePath = getRelativePathForWorkspace(uri);
            autoSaveGenerated = true;
          }
        }

        let exists = true;
        try {
          await vscode.workspace.fs.stat(uri);
        } catch {
          exists = false;
        }

        let approved = true;
        if (confirmEdits && !autoApprove.edit) {
          if (exists) {
            approved = await showDiffAndConfirm(uri, text, `Navrh zmen: ${vscode.workspace.asRelativePath(uri)}`);
          } else {
            const previewDoc = await vscode.workspace.openTextDocument({ content: text });
            await vscode.window.showTextDocument(previewDoc, { preview: true });
            const choice = await vscode.window.showInformationMessage(
              `Vytvorit novy soubor ${vscode.workspace.asRelativePath(uri)}?`,
              { modal: true },
              'Vytvorit',
              'Zamitnout'
            );
            approved = choice === 'Vytvorit';
          }
        }

        if (!approved) {
          return { ok: true, tool: name, approved: false, message: 'zmena zamitnuta uzivatelem' };
        }

        if (exists) {
          const existing = await readFileForTool(uri, DEFAULT_MAX_WRITE_BYTES);
          if (existing.text === undefined) {
            return {
              ok: false,
              tool: name,
              message: existing.error ?? 'soubor nelze precist',
              data: {
                sizeBytes: existing.size,
                binary: existing.binary ?? false
              }
            };
          }
          const applied = await applyFileContent(uri, text);
          if (applied) {
            const relativePath = getRelativePathForWorkspace(uri);
            markToolMutation(session, name);
            recordToolWrite(session, 'updated', relativePath);
            lastReadHashes.set(uri.fsPath, { hash: computeContentHash(text), updatedAt: Date.now() });
            const shouldOpenUpdated = autoOpenOnWrite || (autoOpenAutoSave && isInAutoSaveDir(uri));
            if (shouldOpenUpdated) {
              await revealWrittenDocument(uri);
            }
            await notifyToolWrite('updated', uri);
          }
          return {
            ok: applied,
            tool: name,
            approved: applied,
            message: applied ? 'soubor upraven' : 'nepodarilo se upravit soubor',
            data: applied ? { path: getRelativePathForWorkspace(uri), action: 'updated' } : undefined
          };
        }

        const parent = vscode.Uri.file(path.dirname(uri.fsPath));
        await vscode.workspace.fs.createDirectory(parent);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
        const shouldOpenCreated = autoOpenOnWrite || (autoOpenAutoSave && (autoSaveGenerated || isInAutoSaveDir(uri)));
        if (shouldOpenCreated) {
          const opened = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(opened, { preview: false });
        }
        await notifyToolWrite('created', uri);
        const createdPath = getRelativePathForWorkspace(uri);
        markToolMutation(session, name);
        recordToolWrite(session, 'created', createdPath);
        lastReadHashes.set(uri.fsPath, { hash: computeContentHash(text), updatedAt: Date.now() });
        return {
          ok: true,
          tool: name,
          approved: true,
          message: 'soubor vytvoren',
          data: { path: createdPath, action: 'created' }
        };
      }
      case 'rename_file': {
        const fromPath = asString(args.from);
        const toPath = asString(args.to);
        if (!fromPath || !toPath) return { ok: false, tool: name, message: 'from a to jsou povinne' };
        const fromResolved = await resolveWorkspaceUri(fromPath, true);
        const toResolved = await resolveWorkspaceUri(toPath, false);
        if (!fromResolved.uri || !toResolved.uri) {
          return {
            ok: false,
            tool: name,
            message: fromResolved.error ?? toResolved.error ?? 'soubor mimo workspace nebo nenalezen',
            data: fromResolved.conflicts || toResolved.conflicts
              ? { conflicts: fromResolved.conflicts ?? toResolved.conflicts }
              : undefined
          };
        }
        const fromUri = fromResolved.uri;
        const toUri = toResolved.uri;

        let approved = true;
        if (confirmEdits && !autoApprove.edit) {
          const choice = await vscode.window.showInformationMessage(
            `Prejmenovat ${vscode.workspace.asRelativePath(fromUri)} na ${vscode.workspace.asRelativePath(toUri)}?`,
            { modal: true },
            'Prejmenovat',
            'Zamitnout'
          );
          approved = choice === 'Prejmenovat';
        }
        if (!approved) return { ok: true, tool: name, approved: false, message: 'zmena zamitnuta uzivatelem' };

        await vscode.workspace.fs.rename(fromUri, toUri, { overwrite: false });
        markToolMutation(session, name);
        return { ok: true, tool: name, approved: true, message: 'soubor prejmenovan' };
      }
      case 'delete_file': {
        const filePath = asString(args.path);
        if (!filePath) return { ok: false, tool: name, message: 'path je povinny' };
        const resolved = await resolveWorkspaceUri(filePath, true);
        if (!resolved.uri) {
          return {
            ok: false,
            tool: name,
            message: resolved.error ?? 'soubor nenalezen nebo mimo workspace',
            data: resolved.conflicts ? { conflicts: resolved.conflicts } : undefined
          };
        }
        const uri = resolved.uri;

        let approved = true;
        if (confirmEdits && !autoApprove.edit) {
          const choice = await vscode.window.showInformationMessage(
            `Smazat soubor ${vscode.workspace.asRelativePath(uri)}?`,
            { modal: true },
            'Smazat',
            'Zamitnout'
          );
          approved = choice === 'Smazat';
        }
        if (!approved) return { ok: true, tool: name, approved: false, message: 'zmena zamitnuta uzivatelem' };

        await vscode.workspace.fs.delete(uri, { recursive: false });
        markToolMutation(session, name);
        return { ok: true, tool: name, approved: true, message: 'soubor smazan' };
      }
      default:
        return { ok: false, tool: name, message: 'neznamy nastroj' };
    }
  } catch (err) {
    return { ok: false, tool: name, message: `chyba: ${String(err)}` };
  }
}

async function executeModelCallWithMessages(
  baseUrl: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  timeout: number,
  abortSignal?: AbortSignal,
  forceJson?: boolean
): Promise<string> {
  const url = `${baseUrl}/api/chat`;
  const options = {
    repeat_penalty: 1.2,
    repeat_last_n: 256,
    num_predict: getMaxOutputTokens(forceJson ? 1024 : 2048),
    temperature: forceJson ? 0.1 : 0.3,
    num_ctx: getContextTokens()
  };
  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    options
  };
  if (forceJson) {
    body.format = 'json';
  }
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal: abortSignal
  }, timeout);

  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';

  for await (const chunk of res.body as any) {
    if (!chunk) continue;
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.message?.content) {
          fullResponse += parsed.message.content;
        }
      } catch {
        // Ignore malformed JSON
      }
    }
  }

  return fullResponse;
}

async function generateWithTools(
  panel: WebviewWrapper,
  baseUrl: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  timeout: number,
  maxIterations: number,
  confirmEdits: boolean,
  requirements?: ToolRequirements,
  toolOptions?: ToolCallOptions,
  abortSignal?: AbortSignal,
  session?: ToolSessionState,
  autoApprovePolicy?: AutoApprovePolicy
): Promise<string> {
  const iterations = clampNumber(maxIterations, 6, 1, 10);
  const workingMessages = messages.map(m => ({ ...m }));
  const requireToolCall = requirements?.requireToolCall ?? false;
  const requireMutation = requirements?.requireMutation ?? false;
  const startHadMutations = session?.hadMutations ?? false;
  let sawToolCall = false;
  let localMutation = false;
  const systemPromptOverride = toolOptions?.systemPromptOverride ?? systemPrompt;
  const fallbackModel = (toolOptions?.fallbackModel || '').trim();
  let currentModel = (toolOptions?.primaryModel || model).trim();
  let switchedToFallback = false;

  if (outputChannel) {
    const fallbackLabel = fallbackModel ? `, fallback=${fallbackModel}` : '';
    outputChannel.appendLine(`[Tools] Model selection: primary=${currentModel}${fallbackLabel}`);
  }

  if (requireToolCall || requireMutation) {
    workingMessages.push({
      role: 'system',
      content: [
        'TOOL MODE:',
        'Odpovidej vyhradne tool_call bloky. Zadny text mimo tool_call.',
        requireMutation
          ? 'Musis provest zmenu souboru (write_file/replace_lines).'
          : 'Musis pouzit aspon jeden tool_call.',
        'Priklad:',
        '<tool_call>{"name":"write_file","arguments":{"path":"out/priklad.txt","text":"..."} }</tool_call>'
      ].join('\n')
    });
  }

  for (let i = 0; i < iterations; i++) {
    if (abortSignal?.aborted) {
      const abortErr = new Error('AbortError');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    let response: string;
    try {
      response = await executeModelCallWithMessages(
        baseUrl,
        currentModel,
        systemPromptOverride,
        workingMessages,
        timeout,
        abortSignal,
        toolOptions?.forceJson ?? false
      );
    } catch (err) {
      if (fallbackModel && !switchedToFallback && currentModel !== fallbackModel) {
        outputChannel?.appendLine(`[Tools] Tool model failed, switching to fallback: ${fallbackModel}`);
        currentModel = fallbackModel;
        switchedToFallback = true;
        continue;
      }
      throw err;
    }

    const { calls, remainingText, errors } = parseToolCalls(response);
    if (calls.length === 0) {
      if (errors.length > 0) {
        if (requireToolCall) {
          workingMessages.push({
            role: 'system',
            content: [
              'Neplatny format tool callu.',
              'Posli pouze tool_call bloky s validnim JSON.',
              'Neposilej python/bash prikazy ani text mimo tool_call.'
            ].join('\n')
          });
          if (fallbackModel && !switchedToFallback && currentModel !== fallbackModel) {
            outputChannel?.appendLine(`[Tools] Switching to fallback tool model: ${fallbackModel}`);
            currentModel = fallbackModel;
            switchedToFallback = true;
          }
          continue;
        }
        return `Chyba: neplatny format tool callu (${errors.join('; ')})`;
      }
      if (requireToolCall) {
        if (i >= iterations - 1) {
          return 'Chyba: model nepouzil nastroje. Pouzij tool_call a proved pozadovanou akci.';
        }
        workingMessages.push({
          role: 'system',
          content: [
            'MUSIS pouzit nastroje.',
            'Odpovidej pouze tool_call bloky, bez jineho textu.',
            requireMutation
              ? 'Povinne: write_file/replace_lines (zapis do souboru).'
              : 'Povinne: alespon jeden tool_call.',
            'Kdyz nevis cestu, pouzij pick_save_path a pak write_file.'
          ].join('\n')
        });
        if (fallbackModel && !switchedToFallback && currentModel !== fallbackModel) {
          outputChannel?.appendLine(`[Tools] Switching to fallback tool model: ${fallbackModel}`);
          currentModel = fallbackModel;
          switchedToFallback = true;
        }
        continue;
      }
      return response.trim() ? response : 'Chyba: prazdna odpoved';
    }

    sawToolCall = true;
    if (remainingText) {
      outputChannel?.appendLine('[Tools] Ignoring mixed text with tool calls');
      workingMessages.push({
        role: 'system',
        content: 'V odpovedi byly i jine znaky mimo tool_call. Ignoruji je, posilej pouze tool_call bloky.'
      });
    }

    for (const call of calls) {
      const result = await runToolCall(panel, call, confirmEdits, session, autoApprovePolicy);
      if (!result.ok) {
        const message = result.message ?? 'unknown error';
        outputChannel?.appendLine(`[Tools] ${call.name} failed: ${message}`);
        if (result.data !== undefined) {
          try {
            const serialized = JSON.stringify(result.data);
            if (serialized) {
              outputChannel?.appendLine(`[Tools] ${call.name} data: ${serialized.slice(0, 1000)}`);
            }
          } catch {
            outputChannel?.appendLine(`[Tools] ${call.name} data: [unserializable]`);
          }
        }
      }
      workingMessages.push({
        role: 'assistant',
        content: `<tool_call>${JSON.stringify(call)}</tool_call>`
      });
      workingMessages.push({
        role: 'system',
        content: `<tool_result>${JSON.stringify(result)}</tool_result>`
      });
      if (result.ok && ['write_file', 'replace_lines', 'rename_file', 'delete_file'].includes(call.name)) {
        localMutation = true;
      }
    }

    const mutated = session?.hadMutations ?? localMutation;
    if (requireMutation && !mutated) {
      if (i >= iterations - 1) {
        return 'Chyba: nebyla provedena zadna zmena souboru. Pouzij write_file nebo replace_lines.';
      }
      workingMessages.push({
        role: 'system',
        content: 'Musis provest zmenu souboru (write_file/replace_lines). Pouhe cteni nebo listovani nestaci.'
      });
    } else if (mutated) {
      const writePath = session?.lastWritePath;
      return writePath
        ? `Hotovo: zmena souboru provedena (${writePath}).`
        : 'Hotovo: zmena souboru provedena.';
    } else if (requireToolCall && sawToolCall) {
      return 'Hotovo: nastroje byly pouzity.';
    }
  }

  if (requireToolCall && !sawToolCall) {
    return 'Chyba: model nepouzil nastroje. Pouzij tool_call a proved pozadovanou akci.';
  }
  if (requireMutation && !(session?.hadMutations ?? localMutation) && !startHadMutations) {
    return 'Chyba: nebyla provedena zadna zmena souboru. Pouzij write_file nebo replace_lines.';
  }
  return 'Chyba: prekrocen limit tool iteraci';
}

/**
 * Execute a single model call for step-by-step execution
 */
async function executeModelCall(
  panel: WebviewWrapper,
  baseUrl: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  timeout: number,
  guardianEnabled: boolean,
  silentMode: boolean = true,  // Don't stream to UI during validation
  stepTimeoutMs?: number
): Promise<string> {
  const url = `${baseUrl}/api/chat`;
  const controller = new AbortController();
  const actualTimeout = typeof stepTimeoutMs === 'number' && stepTimeoutMs > 0
    ? stepTimeoutMs
    : timeout;
  const timeoutId = setTimeout(() => controller.abort(), actualTimeout);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        options: {
          repeat_penalty: 1.2,
          repeat_last_n: 256,
          num_predict: getMaxOutputTokens(4096), // Much longer context for thorough file analysis
          temperature: 0.3, // Lower temperature for methodical work
          num_ctx: getContextTokens()
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';

    for await (const chunk of res.body as any) {
      if (!chunk) continue;
      buffer += decoder.decode(chunk, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) continue;

        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            fullResponse += parsed.message.content;
            // Only stream to UI if not in silent mode (during validation)
            // Response will be sent after full pipeline approval
          }
        } catch {
          // Ignore JSON parse errors
        }
      }
    }

    // Apply guardian if enabled
    if (guardianEnabled && fullResponse) {
      const guardianResult = guardian.analyze(fullResponse, userPrompt);
      if (!guardianResult.isOk) {
        fullResponse = guardianResult.cleanedResponse;
      }
    }

    return fullResponse;

  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const error = err as Error;
    if (error.name === 'AbortError') {
      throw new Error('Timeout při generování kroku');
    }
    throw err;
  }
}

async function fetchWithTimeout(
  url: string,
  options: FetchOptions,
  timeout: number
): Promise<Response> {
  const controller = new AbortController();
  let timeoutId: NodeJS.Timeout | null = null;

  const originalSignal = options.signal as AbortSignal | undefined;
  
  // Forward caller aborts into our controller and clean up timeout
  const abortHandler = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };
  
  if (originalSignal) {
    if (originalSignal.aborted) {
      abortHandler();
    } else {
      originalSignal.addEventListener('abort', abortHandler);
    }
  }

  try {
    timeoutId = setTimeout(abortHandler, timeout);

    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    if (originalSignal) {
      originalSignal.removeEventListener('abort', abortHandler);
    }
  }
}

function normalizeTaskWeight(w: number | undefined): number {
  // Normalize existing 0.1-1.0 scale to 1-10, and clamp any value to [1,10]
  if (typeof w !== 'number' || isNaN(w)) return 5;
  if (w <= 1) {
    // assume legacy 0.1-1.0 scale
    return Math.max(1, Math.min(10, Math.round(w * 10)));
  }
  return Math.max(1, Math.min(10, Math.round(w)));
}

function getContextTokens(): number {
  const config = vscode.workspace.getConfiguration('shumilek');
  let tokens = config.get<number>('contextTokens', DEFAULT_CONTEXT_TOKENS);
  if (typeof tokens !== 'number' || Number.isNaN(tokens)) {
    tokens = DEFAULT_CONTEXT_TOKENS;
  }
  return clampNumber(tokens, DEFAULT_CONTEXT_TOKENS, MIN_CONTEXT_TOKENS, MAX_CONTEXT_TOKENS);
}

function getMaxOutputTokens(fallback: number): number {
  const config = vscode.workspace.getConfiguration('shumilek');
  const backendType = config.get<string>('backendType', 'ollama');
  if (backendType !== 'airllm') return fallback;
  let tokens = config.get<number>('airllm.maxOutputTokens', DEFAULT_AIRLLM_MAX_OUTPUT_TOKENS);
  if (typeof tokens !== 'number' || Number.isNaN(tokens)) {
    tokens = DEFAULT_AIRLLM_MAX_OUTPUT_TOKENS;
  }
  return clampNumber(tokens, DEFAULT_AIRLLM_MAX_OUTPUT_TOKENS, MIN_AIRLLM_MAX_OUTPUT_TOKENS, fallback);
}

function getToolsEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration('shumilek').get<boolean>('toolsEnabled', true);
}

function getSafeModeSetting(): boolean {
  return vscode.workspace.getConfiguration('shumilek').get<boolean>('toolsConfirmEdits', false);
}

function getToolsAutoOpenAutoSaveSetting(): boolean {
  return vscode.workspace.getConfiguration('shumilek').get<boolean>('toolsAutoOpenAutoSave', true);
}

function getToolsAutoOpenOnWriteSetting(): boolean {
  return vscode.workspace.getConfiguration('shumilek').get<boolean>('toolsAutoOpenOnWrite', false);
}

function getToolsWriteToastSetting(): boolean {
  return vscode.workspace.getConfiguration('shumilek').get<boolean>('toolsWriteToast', false);
}

async function toggleToolsEnabledSetting(): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('shumilek');
  const current = config.get<boolean>('toolsEnabled', true);
  const target = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  const nextValue = !current;
  await config.update('toolsEnabled', nextValue, target);
  return nextValue;
}

async function toggleSafeModeSetting(): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('shumilek');
  const current = config.get<boolean>('toolsConfirmEdits', false);
  const target = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  const nextValue = !current;
  await config.update('toolsConfirmEdits', nextValue, target);
  return nextValue;
}

function broadcastToolsStatusToWebviews(): void {
  postToAllWebviews({
    type: 'toolsStatus',
    toolsEnabled: getToolsEnabledSetting(),
    confirmEdits: getSafeModeSetting()
  });
}

async function revealWrittenDocument(uri: vscode.Uri): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function revealWrittenInExplorer(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.commands.executeCommand('revealInExplorer', uri);
  } catch (err) {
    outputChannel?.appendLine(`[Tools] Reveal in explorer failed: ${String(err)}`);
  }
}


async function notifyToolWrite(action: 'created' | 'updated', uri: vscode.Uri): Promise<void> {
  const relativePath = getRelativePathForWorkspace(uri);
  postToAllWebviews({
    type: 'toolWrite',
    action,
    path: relativePath
  });
  if (getToolsWriteToastSetting()) {
    const title = action === 'created' ? 'Soubor vytvoren' : 'Soubor upraven';
    void vscode.window.showInformationMessage(`${title}: ${relativePath}`);
  }
  const shouldReveal = action === 'created'
    ? (getToolsAutoOpenOnWriteSetting() || getToolsAutoOpenAutoSaveSetting())
    : getToolsAutoOpenOnWriteSetting();
  if (shouldReveal) {
    await revealWrittenInExplorer(uri);
  }
}

function updateToolsStatusBarItems(): void {
  if (!toolsStatusBarItem || !confirmStatusBarItem) return;

  const toolsEnabled = getToolsEnabledSetting();
  const confirmEdits = getSafeModeSetting();

  toolsStatusBarItem.text = toolsEnabled ? 'Šumílek: Nástroje zapnuté' : 'Šumílek: Nástroje vypnuté';
  toolsStatusBarItem.tooltip = toolsEnabled
    ? 'Nástroje Šumílka jsou zapnuté (klik pro vypnutí)'
    : 'Nástroje Šumílka jsou vypnuté (klik pro zapnutí)';
  toolsStatusBarItem.command = 'shumilek.toggleToolsEnabled';
  toolsStatusBarItem.color = toolsEnabled ? undefined : new vscode.ThemeColor('statusBarItem.warningForeground');

  confirmStatusBarItem.text = confirmEdits ? 'Šumílek: Potvrzování zapnuto' : 'Šumílek: Potvrzování vypnuto';
  confirmStatusBarItem.tooltip = confirmEdits
    ? 'Úpravy souborů vyžadují potvrzení (klik pro vypnutí)'
    : 'Úpravy souborů se aplikují automaticky (klik pro zapnutí)';
  confirmStatusBarItem.command = 'shumilek.toggleToolsConfirmEdits';
  confirmStatusBarItem.color = confirmEdits ? new vscode.ThemeColor('statusBarItem.warningForeground') : undefined;

  toolsStatusBarItem.show();
  confirmStatusBarItem.show();
  broadcastToolsStatusToWebviews();
}

function getActiveEditorContent(): string {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return '';
  }

  const doc = editor.document;
  const text = doc.getText();
  const maxLen = 50000;

  if (text.length > maxLen) {
    return text.slice(0, maxLen) + `\n...\n[Zkráceno na ${maxLen} znaků]`;
  }
  return text;
}

function getActiveFileName(): string {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return '';
  }
  return editor.document.fileName.split(/[\\/]/).pop() || '';
}

// ============================================================
// MINIMAL WEBVIEW FOR DEBUGGING
// ============================================================

function getMinimalWebviewContent(webview: vscode.Webview): string {
  const nonce = getNonce();

  return '<!DOCTYPE html>' +
    '<html lang="cs">' +
    '<head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\';">' +
    '<style>' +
    'body { font-family: sans-serif; background: #1e1e1e; color: white; padding: 20px; }' +
    '#chat { min-height: 200px; border: 1px solid #444; padding: 10px; margin-bottom: 10px; }' +
    '#prompt { width: 80%; padding: 8px; }' +
    '#send-btn { padding: 8px 16px; }' +
    '.message { padding: 8px; margin: 4px 0; border-radius: 4px; }' +
    '.user { background: #264f78; }' +
    '.assistant { background: #3c3c3c; }' +
    '</style>' +
    '</head>' +
    '<body>' +
    '<h2>Šumílek Chat - MINIMAL TEST</h2>' +
    '<div id="status-dot" style="display:inline-block;width:10px;height:10px;background:green;border-radius:50%;"></div>' +
    '<span id="status-text">Online</span>' +
    '<div id="chat"></div>' +
    '<input type="text" id="prompt" placeholder="Napište zprávu...">' +
    '<button id="send-btn">Odeslat</button>' +
    '<button id="stop-btn" style="display:none;">Stop</button>' +
    '<button id="file-btn">Soubor</button>' +
    '<button id="clear-btn">Vymazat</button>' +
    '<button id="guardian-btn">Guardian</button>' +
    '<div id="guardian-alert" style="display:none;"></div>' +
    '<span id="guardian-alert-text"></span>' +
    '<div id="svedomi-loader" style="display:none;"></div>' +
    '<div id="undo-snackbar" style="display:none;"><span id="undo-text"></span><button id="undo-btn">Undo</button></div>' +
    '<script nonce="' + nonce + '">' +
    'console.log("SCRIPT START");' +
    'var vscode = acquireVsCodeApi();' +
    'var chat = document.getElementById("chat");' +
    'var prompt = document.getElementById("prompt");' +
    'var sendBtn = document.getElementById("send-btn");' +
    'var stopBtn = document.getElementById("stop-btn");' +
    'var statusDot = document.getElementById("status-dot");' +
    'var statusText = document.getElementById("status-text");' +
    'var busy = false;' +
    'var currentResponse = "";' +
    'function send() {' +
    '  if (busy) return;' +
    '  var text = prompt.value.trim();' +
    '  if (!text) return;' +
    '  prompt.value = "";' +
    '  addMessage(text, "user");' +
    '  addMessage("...", "assistant");' +
    '  busy = true;' +
    '  statusText.textContent = "Generuji...";' +
    '  statusDot.style.background = "orange";' +
    '  currentResponse = "";' +
    '  vscode.postMessage({ type: "chat", prompt: text });' +
    '}' +
    'function addMessage(text, role) {' +
    '  var div = document.createElement("div");' +
    '  div.className = "message " + role;' +
    '  div.textContent = text;' +
    '  chat.appendChild(div);' +
    '}' +
    'function updateLastAssistant(text) {' +
    '  var msgs = chat.querySelectorAll(".assistant");' +
    '  if (msgs.length > 0) msgs[msgs.length-1].textContent = text;' +
    '}' +
    'sendBtn.addEventListener("click", send);' +
    'prompt.addEventListener("keydown", function(e) { if (e.key === "Enter") send(); });' +
    'stopBtn.addEventListener("click", function() { vscode.postMessage({ type: "stop" }); });' +
    'document.getElementById("file-btn").addEventListener("click", function() { vscode.postMessage({ type: "requestActiveFile" }); });' +
    'document.getElementById("clear-btn").addEventListener("click", function() { if(confirm("Vymazat?")) vscode.postMessage({ type: "clearHistory" }); });' +
    'document.getElementById("guardian-btn").addEventListener("click", function() { vscode.postMessage({ type: "getGuardianStats" }); });' +
    'window.addEventListener("message", function(event) {' +
    '  var msg = event.data;' +
    '  if (msg.type === "responseChunk") {' +
    '    currentResponse += msg.text;' +
    '    updateLastAssistant(currentResponse);' +
    '  } else if (msg.type === "responseDone" || msg.type === "responseStopped" || msg.type === "responseError") {' +
    '    busy = false;' +
    '    statusText.textContent = "Online";' +
    '    statusDot.style.background = "green";' +
    '    if (msg.type === "responseError") updateLastAssistant("Chyba: " + msg.text);' +
    '  } else if (msg.type === "historyCleared") {' +
    '    chat.innerHTML = "";' +
    '  }' +
    '});' +
    'console.log("SCRIPT READY");' +
    'vscode.postMessage({ type: "debugLog", text: "Minimal webview loaded OK" });' +
    '</script>' +
    '</body>' +
    '</html>';
}

// ============================================================
// WEBVIEW CONTENT
// ============================================================

function getWebviewContent(webview: vscode.Webview, initialMessages: ChatMessage[]): string {
  const nonce = getNonce();
  const safeModeEnabled = vscode.workspace.getConfiguration('shumilek').get<boolean>('toolsConfirmEdits', false);
  const sendWatchdogMs = Math.max(15000, resolveTimeoutMs(vscode.workspace.getConfiguration('shumilek')));
  
  // Build HTML using string concatenation to avoid template literal escaping issues
  let html = '<!DOCTYPE html>';
  html += '<html lang="cs">';
  html += '<head>';
  html += '<meta charset="UTF-8">';
  html += '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\';">';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
  html += '<style>';
  html += ':root {';
  html += '  --bg-primary: #0a0f1a;';
  html += '  --bg-secondary: #111827;';
  html += '  --bg-tertiary: #1e293b;';
  html += '  --accent: #3b82f6;';
  html += '  --accent-hover: #2563eb;';
  html += '  --text-primary: #f1f5f9;';
  html += '  --text-secondary: #94a3b8;';
  html += '  --border: rgba(255,255,255,0.08);';
  html += '  --success: #10b981;';
  html += '  --warning: #f59e0b;';
  html += '  --error: #ef4444;';
  html += '  --guardian: #8b5cf6;';
  html += '}';
  html += '* { box-sizing: border-box; }';
  html += 'body {';
  html += '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';
  html += '  margin: 0; padding: 0;';
  html += '  display: flex; flex-direction: column; height: 100vh;';
  html += '  background: var(--bg-primary); color: var(--text-primary);';
  html += '}';
  html += 'header {';
  html += '  display: flex; align-items: center; justify-content: space-between;';
  html += '  padding: 12px 16px; background: var(--bg-secondary);';
  html += '  border-bottom: 1px solid var(--border); flex-shrink: 0;';
  html += '}';
  html += '.brand { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 15px; }';
  html += '.status-dot {';
  html += '  width: 8px; height: 8px; border-radius: 50%;';
  html += '  background: var(--success); box-shadow: 0 0 8px var(--success); transition: all 0.3s;';
  html += '}';
  html += '.status-dot.busy { background: var(--warning); box-shadow: 0 0 8px var(--warning); animation: pulse 1.2s infinite; }';
  html += '.status-dot.guardian { background: var(--guardian); box-shadow: 0 0 8px var(--guardian); }';
  html += '@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }';
  html += '.header-actions { display: flex; gap: 8px; }';
  html += '.icon-btn {';
  html += '  background: transparent; border: 1px solid var(--border);';
  html += '  color: var(--text-secondary); padding: 6px 10px; border-radius: 6px;';
  html += '  cursor: pointer; font-size: 12px; transition: all 0.2s;';
  html += '}';
  html += '.icon-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }';
  html += '.message-meta { display: flex; gap: 8px; align-items: center; justify-content: flex-end; font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; }';
  html += '.message .message-content { position: relative; }';
  html += '.copy-message-btn { background: transparent; border: 1px solid rgba(255,255,255,0.06); color: var(--text-secondary); padding: 4px 8px; font-size: 11px; border-radius: 6px; cursor: pointer; }';
  html += '.copy-message-btn:hover { color: var(--text-primary); }';
  html += '.collapsible { transition: max-height 300ms ease, opacity 200ms ease; }';
  html += '.collapsible.collapsed { max-height: 220px; overflow: hidden; position: relative; }';
  html += '.show-more-btn { background: transparent; border: 1px solid rgba(255,255,255,0.06); color: var(--accent); padding: 4px 8px; font-size: 12px; border-radius: 6px; cursor: pointer; }';
  html += '#undo-snackbar { position: fixed; right: 20px; bottom: 20px; display: flex; gap: 8px; align-items: center; padding: 8px 12px; background: rgba(0,0,0,0.6); border-radius: 8px; border: 1px solid rgba(255,255,255,0.04); box-shadow: 0 6px 20px rgba(0,0,0,0.5); color: var(--text-primary); z-index: 60; opacity: 0; transform: translateY(10px); transition: opacity 200ms ease, transform 200ms ease; }';
  html += '#undo-snackbar.undo-show { opacity: 1; transform: translateY(0); }';
  html += '#undo-snackbar.undo-hidden { display: none; }';
  html += '#guardian-alert { position: fixed; top: 12px; right: 12px; display: none; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 10px; background: rgba(139, 92, 246, 0.12); color: var(--text-primary); border: 1px solid var(--guardian); box-shadow: 0 8px 30px rgba(0,0,0,0.35); transition: transform 300ms ease, opacity 300ms ease; transform-origin: top right; z-index: 80; }';
  html += '#guardian-alert.show { display: flex; animation: guardianPop 420ms ease; }';
  html += '@keyframes guardianPop { 0% { transform: scale(0.98); opacity: 0 } 60% { transform: scale(1.02); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }';
  html += '#chat { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }';
  html += '.message { display: flex; flex-direction: column; max-width: 85%; animation: fadeIn 0.2s ease; }';
  html += '@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }';
  html += '.message.user { align-self: flex-end; }';
  html += '.message.assistant { align-self: flex-start; }';
  html += '.message-content { padding: 12px 16px; border-radius: 12px; font-size: 14px; line-height: 1.6; }';
  html += '.message.user .message-content { background: linear-gradient(135deg, #6366f1, #3b82f6); color: white; border-bottom-right-radius: 4px; }';
  html += '.message.assistant .message-content { background: var(--bg-tertiary); border: 1px solid var(--border); border-bottom-left-radius: 4px; }';
  
  // Pipeline status messages - hezky v chatu
  html += '.message.pipeline { align-self: center; max-width: 90%; }';
  html += '.message.pipeline .message-content { background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(59, 130, 246, 0.1)); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 12px; padding: 12px 16px; font-size: 13px; }';
  html += '.message.pipeline.planning .message-content { background: linear-gradient(135deg, rgba(234, 179, 8, 0.15), rgba(245, 158, 11, 0.1)); border-color: rgba(234, 179, 8, 0.4); }';
  html += '.message.pipeline.step .message-content { background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(99, 102, 241, 0.1)); border-color: rgba(59, 130, 246, 0.3); }';
  html += '.message.pipeline.review .message-content { background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(168, 85, 247, 0.1)); border-color: rgba(139, 92, 246, 0.3); }';
  html += '.message.pipeline.validation .message-content { background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(52, 211, 153, 0.1)); border-color: rgba(16, 185, 129, 0.3); }';
  html += '.message.pipeline.approved .message-content { background: linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(74, 222, 128, 0.1)); border-color: rgba(34, 197, 94, 0.4); }';
  html += '.message.pipeline.rejected .message-content { background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(248, 113, 113, 0.1)); border-color: rgba(239, 68, 68, 0.3); }';
  
  /* Unified Pipeline Log CSS */
  html += '.message.pipeline-log { width: 100%; max-width: 95%; align-self: center; margin: 4px 0; }';
  html += '.message.pipeline-log .message-content { background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(255,255,255,0.1); padding: 0; overflow: hidden; display: flex; flex-direction: column; }';
  html += '.pipeline-header { padding: 10px 14px; background: rgba(255, 255, 255, 0.03); border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 600; color: var(--text-primary); }';
  html += '.pipeline-items { padding: 8px 14px; display: flex; flex-direction: column; gap: 6px; }';
  html += '.pipeline-item { display: flex; align-items: flex-start; gap: 10px; font-size: 12px; color: var(--text-secondary); line-height: 1.4; padding: 2px 0; }';
  html += '.pipeline-item .item-icon { flex-shrink: 0; width: 16px; text-align: center; opacity: 0.9; }';
  html += '.pipeline-item .item-text { flex: 1; word-break: break-word; }';
  html += '.pipeline-item.approved { color: var(--success); }';
  html += '.pipeline-item.rejected { color: var(--error); }';
  html += '.pipeline-item.step { color: var(--accent); }';
  
  html += '.pipeline-icon { font-size: 18px; margin-right: 8px; }';
  html += '.pipeline-text { display: inline; }';
  html += '.pipeline-progress { display: inline-block; margin-left: 8px; font-size: 11px; padding: 2px 8px; background: rgba(255,255,255,0.1); border-radius: 10px; color: var(--text-secondary); }';
  html += '.pipeline-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.2); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle; }';
  
  html += '.message-content p { margin: 0 0 8px 0; }';
  html += '.message-content p:last-child { margin-bottom: 0; }';
  html += '.message-content pre { margin: 12px 0; border-radius: 8px; overflow: hidden; background: #0d1117; border: 1px solid var(--border); position: relative; }';
  html += '.message-content pre code { display: block; padding: 12px; overflow-x: auto; font-family: "Fira Code", Consolas, monospace; font-size: 13px; line-height: 1.5; color: #e6edf3; }';
  html += '.copy-btn { position: absolute; top: 8px; right: 8px; background: rgba(255,255,255,0.1); border: none; color: var(--text-secondary); padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; opacity: 0; transition: opacity 0.2s; }';
  html += '.message-content pre:hover .copy-btn { opacity: 1; }';
  html += '.copy-btn:hover { background: rgba(255,255,255,0.2); color: white; }';
  html += '.message-content code { font-family: "Fira Code", Consolas, monospace; background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }';
  html += '.message-content ul, .message-content ol { margin: 8px 0; padding-left: 20px; }';
  html += '.message-content blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid var(--accent); color: var(--text-secondary); }';
  html += '.message-content a { color: #60a5fa; text-decoration: none; }';
  html += '.message-content a:hover { text-decoration: underline; }';
  html += '.typing-indicator { display: flex; gap: 4px; padding: 8px 0; }';
  html += '.typing-indicator span { width: 8px; height: 8px; background: var(--text-secondary); border-radius: 50%; animation: bounce 1.4s infinite; }';
  html += '.typing-indicator span:nth-child(2) { animation-delay: 0.2s; }';
  html += '.typing-indicator span:nth-child(3) { animation-delay: 0.4s; }';
  html += '@keyframes bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-8px); } }';
  html += '.svedomi-loader { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; padding: 24px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4); z-index: 1000; text-align: center; min-width: 280px; }';
  html += '.svedomi-loader.active { display: flex; flex-direction: column; align-items: center; gap: 16px; }';
  html += '.svedomi-spinner { width: 48px; height: 48px; border: 3px solid rgba(59, 130, 246, 0.2); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }';
  html += '@keyframes spin { to { transform: rotate(360deg); } }';
  html += '.svedomi-text { font-size: 14px; color: var(--text-secondary); font-weight: 500; }';
  html += '#input-area { padding: 16px; background: var(--bg-secondary); border-top: 1px solid var(--border); flex-shrink: 0; }';
  html += '#input-container { display: flex; align-items: flex-end; gap: 8px; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 12px; padding: 8px 12px; transition: border-color 0.2s, box-shadow 0.2s; }';
  html += '#input-container:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15); }';
  html += '#prompt { flex: 1; border: none; background: transparent; color: var(--text-primary); font-family: inherit; font-size: 14px; line-height: 1.5; resize: none; min-height: 24px; max-height: 150px; padding: 4px 0; outline: none; }';
  html += '#prompt::placeholder { color: var(--text-secondary); }';
  html += '.action-btn { background: var(--accent); border: none; color: white; width: 36px; height: 36px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; flex-shrink: 0; }';
  html += '.action-btn:hover { background: var(--accent-hover); transform: scale(1.05); }';
  html += '.action-btn:disabled { background: #475569; cursor: not-allowed; transform: none; }';
  html += '.action-btn.stop { background: var(--error); }';
  html += '.action-btn.stop:hover { background: #dc2626; }';
  html += '#toolbar { display: flex; gap: 8px; margin-top: 10px; }';
  html += '.toolbar-btn { display: flex; align-items: center; gap: 6px; background: transparent; border: 1px solid var(--border); color: var(--text-secondary); padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; transition: all 0.2s; }';
  html += '.toolbar-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); border-color: var(--text-secondary); }';
  html += '.toolbar-btn:disabled { opacity: 0.5; cursor: not-allowed; }';
  html += '.toolbar-btn.active { background: rgba(59, 130, 246, 0.15); border-color: var(--accent); color: var(--text-primary); }';
  html += '.tools-status { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; font-size: 11px; }';
  html += '.tools-pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-secondary); }';
  html += '.tools-pill.on { color: var(--accent); border-color: rgba(59, 130, 246, 0.45); }';
  html += '.tools-pill.warn { color: var(--warning); border-color: rgba(245, 158, 11, 0.6); }';
  html += '.tools-toast { margin-top: 6px; padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(59, 130, 246, 0.35); background: rgba(59, 130, 246, 0.12); color: var(--text-primary); font-size: 12px; display: none; }';
  html += '::-webkit-scrollbar { width: 6px; }';
  html += '::-webkit-scrollbar-track { background: transparent; }';
  html += '::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }';
  html += '::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }';
  html += '.welcome { text-align: center; padding: 40px 20px; color: var(--text-secondary); }';
  html += '.welcome h2 { color: var(--text-primary); margin: 0 0 8px 0; font-size: 20px; }';
  html += '.welcome p { margin: 0 0 16px 0; font-size: 14px; }';
  html += '.guardian-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(139, 92, 246, 0.15); color: var(--guardian); padding: 6px 12px; border-radius: 20px; font-size: 12px; }';
  html += '</style>';
  html += '</head>';
  html += '<body>';
  
  // Header
  html += '<header>';
  html += '<div class="brand">';
  html += '<div class="status-dot" id="status-dot"></div>';
  html += '<span>Šumílek AI</span>';
  html += '<span id="status-text" style="font-size: 12px; color: var(--text-secondary)">Online</span>';
  html += '</div>';
  html += '<div class="header-actions">';
  html += '<button class="icon-btn" id="regenerate-btn" title="Regenerovat poslední odpověď">&#128257;</button>';
  html += '<button class="icon-btn" id="copyall-btn" title="Zkopírovat všechny AI odpovědi">&#128203;</button>';
  html += '<button class="icon-btn guardian" id="guardian-btn" title="Guardian Stats">&#128737;</button>';
  html += '<button class="icon-btn" id="clear-btn" title="Vymazat historii">&#128465;</button>';
  html += '</div>';
  html += '</header>';
  
  // Guardian alert - hidden (replaced by pipeline status in chat)
  html += '<div id="guardian-alert" style="display:none !important;"><span>&#128737;</span><span id="guardian-alert-text"></span></div>';
  html += '<div id="undo-snackbar" class="undo-hidden"><span id="undo-text">Historie byla vymazána</span><button id="undo-btn" class="icon-btn">Vrátit</button></div>';
  html += '<div id="chat"></div>';
  
  // Input area
  html += '<div id="input-area">';
  html += '<div id="input-container">';
  html += '<textarea id="prompt" placeholder="Zeptej se na cokoliv..." rows="1"></textarea>';
  html += '<button class="action-btn" id="send-btn" title="Odeslat (Ctrl+Enter)">';
  html += '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
  html += '</button>';
  html += '<button class="action-btn stop" id="stop-btn" style="display: none" title="Zastavit">';
  html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';
  html += '</button>';
  html += '</div>';
  html += '<div class="svedomi-loader" id="svedomi-loader"><div class="svedomi-spinner"></div><div class="svedomi-text">Načítám svedomi...</div></div>';
  html += '<div id="toolbar">';
  html += '<button class="toolbar-btn" id="file-btn">';
  html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>';
  html += 'Přidat soubor';
  html += '</button>';
  html += '<button class="toolbar-btn" id="safe-mode-btn" title="Přepnout potvrzování změn"></button>';
  html += '</div>';
  html += '<div id="tools-status" class="tools-status">';
  html += '<span class="tools-pill" id="tools-status-tools"></span>';
  html += '<span class="tools-pill" id="tools-status-confirm"></span>';
  html += '<span class="tools-pill" id="tools-status-lasttool"></span>';
  html += '<span class="tools-pill" id="tools-status-lastwrite"></span>';
  html += '</div>';
  html += '<div id="tools-toast" class="tools-toast"></div>';
  html += '</div>';
  
  // Script - using string concatenation to avoid escaping nightmares
  html += '<script nonce="' + nonce + '">';
  html += 'console.log("SHUMILEK BOOT");';
  html += 'var vscode = acquireVsCodeApi();';
  html += 'function debugLog(t) { try { vscode.postMessage({ type: "debugLog", text: String(t) }); } catch(e) {} }';
  html += 'window.addEventListener("error", function(e) { debugLog("JS error: " + (e.error ? e.error.stack : e.message)); });';
  html += 'window.addEventListener("unhandledrejection", function(e) { debugLog("Unhandled rejection: " + (e.reason ? e.reason.stack || e.reason.message : e.reason)); });';
  html += 'debugLog("Webview script start");';
  
  html += 'var chat = document.getElementById("chat");';
  html += 'var prompt = document.getElementById("prompt");';
  html += 'var sendBtn = document.getElementById("send-btn");';
  html += 'var stopBtn = document.getElementById("stop-btn");';
  html += 'var fileBtn = document.getElementById("file-btn");';
  html += 'var safeModeBtn = document.getElementById("safe-mode-btn");';
  html += 'var clearBtn = document.getElementById("clear-btn");';
  html += 'var guardianBtn = document.getElementById("guardian-btn");';
  html += 'var toolsStatusTools = document.getElementById("tools-status-tools");';
  html += 'var toolsStatusConfirm = document.getElementById("tools-status-confirm");';
  html += 'var toolsStatusLastTool = document.getElementById("tools-status-lasttool");';
  html += 'var toolsStatusLastWrite = document.getElementById("tools-status-lastwrite");';
  html += 'var toolsToast = document.getElementById("tools-toast");';
  html += 'var statusDot = document.getElementById("status-dot");';
  html += 'var statusText = document.getElementById("status-text");';
  html += 'var guardianAlert = document.getElementById("guardian-alert");';
  html += 'var guardianAlertText = document.getElementById("guardian-alert-text");';
  html += 'var svedomiLoader = document.getElementById("svedomi-loader");';
  html += 'var undoSnackbar = document.getElementById("undo-snackbar");';
  html += 'var undoText = document.getElementById("undo-text");';
  html += 'var undoBtn = document.getElementById("undo-btn");';
  html += 'var regenerateBtn = document.getElementById("regenerate-btn");';
  html += 'var copyAllBtn = document.getElementById("copyall-btn");';
  
  html += 'var busy = false;';
  html += 'var currentResponse = "";';
  html += 'var messages = [];';
  html += 'var undoTimer = null;';
  html += 'var guardianAlertTimer = null;';
  html += 'var sendWatchdogTimer = null;';
  html += 'var lastResponseActivityAt = 0;';
  html += 'var safeMode = ' + (safeModeEnabled ? 'true' : 'false') + ';';
  html += 'var toolsEnabled = ' + (getToolsEnabledSetting() ? 'true' : 'false') + ';';
  html += 'var lastToolName = "";';
  html += 'var lastWriteLabel = "";';
  html += 'var toolsToastTimer = null;';
  html += 'var sendWatchdogMs = ' + sendWatchdogMs + ';';
  
  // Helper functions
  html += 'function clearSendWatchdog() { if (sendWatchdogTimer) { clearTimeout(sendWatchdogTimer); sendWatchdogTimer = null; } }';
  html += 'function armSendWatchdog(ms) {';
  html += '  clearSendWatchdog();';
  html += '  sendWatchdogTimer = setTimeout(function() {';
  html += '    if (busy && Date.now() - lastResponseActivityAt >= ms) {';
  html += '      var lastMsg = chat.querySelector(".message.assistant:last-child");';
  html += '      var typing = lastMsg ? lastMsg.querySelector(".typing-indicator") : null;';
  html += '      if (lastMsg && typing && !currentResponse) lastMsg.remove();';
  html += '      clearPipelineMessages();';
  html += '      setBusy(false);';
  html += '      showGuardianAlert("Odezva nedorazila (casovy limit). Zkus to znovu.", 6000);';
  html += '    }';
  html += '  }, ms);';
  html += '}';
  
  html += 'function showUndoSnackbar(text, duration) {';
  html += '  undoText.textContent = text || "Historie byla vymazána";';
  html += '  undoSnackbar.classList.remove("undo-hidden");';
  html += '  undoSnackbar.classList.add("undo-show");';
  html += '  if (undoTimer) clearTimeout(undoTimer);';
  html += '  undoTimer = setTimeout(hideUndoSnackbar, duration || 8000);';
  html += '}';
  html += 'function hideUndoSnackbar() { if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; } undoSnackbar.classList.remove("undo-show"); undoSnackbar.classList.add("undo-hidden"); }';
  
  html += 'function showSvedomiLoader() { svedomiLoader.classList.add("active"); }';
  html += 'function hideSvedomiLoader() { svedomiLoader.classList.remove("active"); }';
  html += 'function updateToolsStatus() {';
  html += '  if (!toolsStatusTools || !toolsStatusConfirm || !toolsStatusLastTool || !toolsStatusLastWrite) return;';
  html += '  toolsStatusTools.textContent = toolsEnabled ? "Nástroje: zapnuté" : "Nástroje: vypnuté";';
  html += '  toolsStatusTools.className = "tools-pill" + (toolsEnabled ? " on" : " warn");';
  html += '  toolsStatusConfirm.textContent = safeMode ? "Potvrzování: zapnuto" : "Potvrzování: vypnuto";';
  html += '  toolsStatusConfirm.className = "tools-pill" + (safeMode ? " warn" : " on");';
  html += '  toolsStatusLastTool.textContent = "Poslední nástroj: " + (lastToolName || "—");';
  html += '  toolsStatusLastWrite.textContent = "Poslední zápis: " + (lastWriteLabel || "—");';
  html += '}';
  html += 'function showToolsToast(text) {';
  html += '  if (!toolsToast) return;';
  html += '  toolsToast.textContent = text;';
  html += '  toolsToast.style.display = "block";';
  html += '  if (toolsToastTimer) clearTimeout(toolsToastTimer);';
  html += '  toolsToastTimer = setTimeout(function() { toolsToast.style.display = "none"; }, 4000);';
  html += '}';
  
  // Legacy showGuardianAlert - redirect to pipeline status in chat
  html += 'function showGuardianAlert(message, duration) {';
  html += '  addPipelineStatus("🛡️", message, "validation", null, false);';
  html += '}';
  
  html += 'function setBusy(state) {';
  html += '  busy = state;';
  html += '  sendBtn.style.display = state ? "none" : "flex";';
  html += '  stopBtn.style.display = state ? "flex" : "none";';
  html += '  fileBtn.disabled = state;';
  html += '  prompt.disabled = state;';
  html += '  if (state) { statusDot.classList.add("busy"); statusText.textContent = "Generuji..."; }';
  html += '  else { statusDot.classList.remove("busy"); statusDot.classList.remove("guardian"); statusText.textContent = "Online"; }';
  html += '}';
  
  html += 'function scrollToBottom() { chat.scrollTop = chat.scrollHeight; }';
  
  html += 'function formatTime(ts) { if (!ts) return ""; var d = new Date(ts); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }';
  
  // Markdown parser - simplified but safe
  html += 'function parseMarkdown(text) {';
  html += '  if (!text || typeof text !== "string") return "";';
  html += '  if (text.length > 100000) text = text.slice(0, 100000) + "\\n\\n[Obsah zkr?cen]";';
  html += '  var html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");';
  html += '  var tick = String.fromCharCode(96);';
  html += '  var cbRe = new RegExp(tick + tick + tick + "(\\\\w*)?\\\\n([\\\\s\\\\S]*?)" + tick + tick + tick, "g");';
  html += '  html = html.replace(cbRe, function(m, lang, code) { return "<pre><code class=\\"language-" + (lang || "text") + "\\">" + code.trim() + "</code></pre>"; });';
  html += '  var icRe = new RegExp(tick + "([^" + tick + "]+)" + tick, "g");';
  html += '  html = html.replace(icRe, "<code>$1</code>");';
  html += '  html = html.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");';
  html += '  html = html.replace(/\\*([^*]+)\\*/g, "<em>$1</em>");';
  html += '  html = html.replace(/\\n/g, "<br>");';
  html += '  return html;';
  html += '}';
  
  html += 'function addCopyButtons(container) {';
  html += '  container.querySelectorAll("pre").forEach(function(pre) {';
  html += '    if (pre.querySelector(".copy-btn")) return;';
  html += '    var btn = document.createElement("button");';
  html += '    btn.className = "copy-btn";';
  html += '    btn.textContent = "Kop?rovat";';
  html += '    btn.onclick = function() {';
  html += '      var code = pre.querySelector("code");';
  html += '      navigator.clipboard.writeText(code ? code.textContent : "").then(function() {';
  html += '        btn.textContent = "OK!";';
  html += '        setTimeout(function() { btn.textContent = "Kop?rovat"; }, 2000);';
  html += '      });';
  html += '    };';
  html += '    pre.appendChild(btn);';
  html += '  });';
  html += '}';
  
  // Render welcome or messages
  html += 'function renderMessages() {';
  html += '  if (messages.length === 0) {';
  html += '    chat.innerHTML = \'<div class="welcome"><h2>Ahoj!</h2><p>Jsem Sumilek, tvuj AI asistent pro kodovani.</p><div class="guardian-badge">Guardian + Svedomi aktivni</div></div>\';';
  html += '    return;';
  html += '  }';
  html += '  chat.innerHTML = "";';
  html += '  messages.forEach(function(msg) { if (msg.role !== "system") addMessageToUI(msg.content, msg.role, false, msg.timestamp || Date.now()); });';
  html += '  scrollToBottom();';
  html += '}';
  
  html += 'function addMessageToUI(content, role, isStreaming, ts) {';
  html += '  var msgEl = document.createElement("div");';
  html += '  msgEl.className = "message " + role;';
  html += '  var meta = document.createElement("div");';
  html += '  meta.className = "message-meta";';
  html += '  var timeSpan = document.createElement("span");';
  html += '  timeSpan.textContent = formatTime(ts || Date.now());';
  html += '  meta.appendChild(timeSpan);';
  html += '  var contentEl = document.createElement("div");';
  html += '  contentEl.className = "message-content";';
  html += '  if (role === "assistant") {';
  html += '    contentEl.innerHTML = isStreaming && !content ? \'<div class="typing-indicator"><span></span><span></span><span></span></div>\' : parseMarkdown(content);';
  html += '    addCopyButtons(contentEl);';
  html += '    var copyBtn = document.createElement("button");';
  html += '    copyBtn.className = "copy-message-btn";';
  html += '    copyBtn.textContent = "Kop?rovat";';
  html += '    copyBtn.onclick = function() { navigator.clipboard.writeText(contentEl.textContent || ""); copyBtn.textContent = "OK!"; setTimeout(function() { copyBtn.textContent = "Kop?rovat"; }, 1500); };';
  html += '    meta.appendChild(copyBtn);';
  html += '  } else {';
  html += '    var escaped = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");';
  html += '    contentEl.innerHTML = escaped.replace(/\\n/g, "<br>");';
  html += '  }';
  html += '  msgEl.appendChild(meta);';
  html += '  var wrapper = document.createElement("div");';
  html += '  wrapper.className = "collapsible";';
  html += '  wrapper.appendChild(contentEl);';
  html += '  msgEl.appendChild(wrapper);';
  html += '  chat.appendChild(msgEl);';
  html += '  scrollToBottom();';
  html += '  return contentEl;';
  html += '}';
  
  // Pipeline status in chat - Unified Log implementation
  html += 'var currentPipelineLog = null;';
  
  html += 'function getOrCreatePipelineLog() {';
  html += '    if (currentPipelineLog) return currentPipelineLog;';
  html += '    var msgEl = document.createElement("div");';
  html += '    msgEl.className = "message pipeline-log";';
  html += '    var contentEl = document.createElement("div");';
  html += '    contentEl.className = "message-content";';
  html += '    contentEl.innerHTML = \'<div class="pipeline-header"><span class="pipeline-spinner"></span><span class="pipeline-text">Zpracovávám...</span></div><div class="pipeline-items"></div>\';';
  html += '    msgEl.appendChild(contentEl);';
  html += '    chat.appendChild(msgEl);';
  html += '    currentPipelineLog = msgEl;';
  html += '    scrollToBottom();';
  html += '    return msgEl;';
  html += '}';

  html += 'function updatePipelineHeader(icon, text, isLoading) {';
  html += '    var log = getOrCreatePipelineLog();';
  html += '    var header = log.querySelector(".pipeline-header");';
  html += '    var spinnerHtml = isLoading ? \'<span class="pipeline-spinner"></span>\' : (icon ? \'<span class="pipeline-icon" style="margin-right:8px">\' + icon + \'</span>\' : \'\');';
  html += '    header.innerHTML = spinnerHtml + \'<span class="pipeline-text">\' + text + \'</span>\';';
  html += '}';

  html += 'function addPipelineItem(icon, text, type) {';
  html += '    var log = getOrCreatePipelineLog();';
  html += '    var items = log.querySelector(".pipeline-items");';
  html += '    var item = document.createElement("div");';
  html += '    item.className = "pipeline-item " + (type || "");';
  html += '    item.innerHTML = \'<span class="item-icon">\' + icon + \'</span><span class="item-text">\' + text + \'</span>\';';
  html += '    items.appendChild(item);';
  html += '    scrollToBottom();';
  html += '}';
  
  html += 'function addPipelineStatus(icon, text, type, progress, isLoading) {';
  html += '  if (isLoading) { updatePipelineHeader(icon, text, true); }';
  html += '  else { addPipelineItem(icon, text, type); }';
  html += '  return currentPipelineLog;';
  html += '}';
  
  html += 'function updatePipelineStatus(icon, text, type) {';
  html += '  var log = getOrCreatePipelineLog();';
  html += '  var items = log.querySelector(".pipeline-items");';
  html += '  if (items.lastChild) {';
  html += '      items.lastChild.innerHTML = \'<span class="item-icon">\' + icon + \'</span><span class="item-text">\' + text + \'</span>\';';
  html += '      items.lastChild.className = "pipeline-item " + (type || "");';
  html += '  } else { addPipelineItem(icon, text, type); }';
  html += '}';
  
  html += 'function clearPipelineMessages() {';
  html += '  if (currentPipelineLog) {';
  html += '      var header = currentPipelineLog.querySelector(".pipeline-header");';
  html += '      if (header && header.querySelector(".pipeline-spinner")) {';
  html += '          header.innerHTML = \'<span class="pipeline-icon" style="margin-right:8px">✅</span><span class="pipeline-text">Hotovo</span>\';';
  html += '      }';
  html += '      currentPipelineLog = null;';
  html += '  }';
  html += '}';

  html += 'function updateLastAssistantMessage(content) {';
  html += '  var assistantMsgs = chat.querySelectorAll(".message.assistant:not(.pipeline)");';
  html += '  var lastMsg = assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1].querySelector(".message-content") : null;';
  html += '  if (lastMsg) { lastMsg.innerHTML = parseMarkdown(content); addCopyButtons(lastMsg); scrollToBottom(); }';
  html += '}';
  
  html += 'function updateSafeModeButton() {';
  html += '  if (!safeModeBtn) return;';
  html += '  safeModeBtn.textContent = safeMode ? "Potvrzování: zapnuto" : "Potvrzování: vypnuto";';
  html += '  if (safeMode) safeModeBtn.classList.add("active"); else safeModeBtn.classList.remove("active");';
  html += '  updateToolsStatus();';
  html += '}';
  
  // Send / stop functions
  html += 'function send() {';
  html += '  if (busy) { addPipelineStatus("⏳", "Je?t? generuji. Chv?li po?kej.", "validation", null, false); return; }';
  html += '  var text = prompt.value.trim();';
  html += '  if (!text) return;';
  html += '  prompt.value = "";';
  html += '  prompt.style.height = "auto";';
  html += '  addMessageToUI(text, "user", false, Date.now());';
  html += '  addMessageToUI("", "assistant", true, Date.now());';
  html += '  setBusy(true);';
  html += '  currentResponse = "";';
  html += '  lastResponseActivityAt = Date.now();';
  html += '  armSendWatchdog(sendWatchdogMs);';
  html += '  vscode.postMessage({ type: "chat", prompt: text });';
  html += '}';
  
  html += 'function stop() {';
  html += '  clearSendWatchdog();';
  html += '  if (busy) setBusy(false);';
  html += '  vscode.postMessage({ type: "stop" });';
  html += '}';
  
  html += 'function clearHistory() {';
  html += '  if (confirm("Opravdu chces vymazat celou historii?")) vscode.postMessage({ type: "clearHistory" });';
  html += '}';
  
  html += 'function regenerateLast() {';
  html += '  if (busy) return;';
  html += '  if (!messages || messages.length === 0) { showGuardianAlert("??dn? p?edchoz? dotaz", 3000); return; }';
  html += '  for (var i = messages.length - 1; i >= 0; i--) {';
  html += '    if (messages[i] && messages[i].role === "user") {';
  html += '      var promptText = messages[i].content;';
  html += '      addMessageToUI(promptText, "user", false, Date.now());';
  html += '      addMessageToUI("", "assistant", true, Date.now());';
  html += '      currentResponse = "";';
  html += '      setBusy(true);';
  html += '      vscode.postMessage({ type: "chat", prompt: promptText });';
  html += '      return;';
  html += '    }';
  html += '  }';
  html += '  showGuardianAlert("??dn? p?edchoz? dotaz", 3000);';
  html += '}';
  
  html += 'function copyAllAssistantMessages() {';
  html += '  var nodes = document.querySelectorAll(".message.assistant .message-content");';
  html += '  var texts = [];';
  html += '  nodes.forEach(function(n) { if (n.textContent) texts.push(n.textContent); });';
  html += '  if (texts.length === 0) { showGuardianAlert("??dn? odpov?di", 2500); return; }';
  html += '  navigator.clipboard.writeText(texts.join("\\n\\n")).then(function() { showGuardianAlert("Zkop?rov?no!", 2000); });';
  html += '}';
  
  html += 'function showGuardianStatsModal(stats) {';
  html += '  var existing = document.getElementById("guardian-stats-modal");';
  html += '  if (existing) existing.remove();';
  html += '  var modal = document.createElement("div");';
  html += '  modal.id = "guardian-stats-modal";';
  html += '  modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000;";';
  html += '  modal.innerHTML = \'<div style="background:var(--bg-secondary);border-radius:12px;padding:24px;max-width:400px;width:90%;border:1px solid var(--border);">\' +';
  html += '    \'<h3 style="margin:0 0 16px 0;color:var(--guardian);">Guardian Statistiky</h3>\' +';
  html += '    \'<div style="font-size:14px;">Kontrol: \' + stats.totalChecks + \'<br>Smy?ky: \' + stats.loopsDetected + \'<br>Opakov?n?: \' + stats.repetitionsFixed + \'<br>Retries: \' + stats.retriesTriggered + \'</div>\' +';
  html += '    \'<h4 style="margin:16px 0 8px 0;color:var(--accent);">Svedomi</h4>\' +';
  html += '    \'<div style="font-size:14px;">Validace: \' + stats.miniModelValidations + \'<br>Zamitnuti: \' + stats.miniModelRejections + \'</div>\' +';
  html += '    \'<button id="close-stats-modal" style="margin-top:16px;width:100%;padding:10px;background:var(--accent);border:none;border-radius:8px;color:white;cursor:pointer;">Zav??t</button>\' +';
  html += '    \'</div>\';';
  html += '  document.body.appendChild(modal);';
  html += '  modal.onclick = function(e) { if (e.target === modal) modal.remove(); };';
  html += '  document.getElementById("close-stats-modal").onclick = function() { modal.remove(); };';
  html += '}';
  
  // Event listeners
  html += 'prompt.addEventListener("input", function() { prompt.style.height = "auto"; prompt.style.height = Math.min(prompt.scrollHeight, 150) + "px"; });';
  html += 'prompt.addEventListener("keydown", function(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });';
  html += 'sendBtn.addEventListener("click", function() { debugLog("Send click"); send(); });';
  html += 'stopBtn.addEventListener("click", function() { debugLog("Stop click"); stop(); });';
  html += 'fileBtn.addEventListener("click", function() { debugLog("File click"); vscode.postMessage({ type: "requestActiveFile" }); });';
  html += 'if (safeModeBtn) safeModeBtn.addEventListener("click", function() { debugLog("Safe mode toggle"); vscode.postMessage({ type: "toggleSafeMode" }); });';
  html += 'clearBtn.addEventListener("click", function() { debugLog("Clear click"); clearHistory(); });';
  html += 'guardianBtn.addEventListener("click", function() { debugLog("Guardian click"); vscode.postMessage({ type: "getGuardianStats" }); });';
  html += 'if (regenerateBtn) regenerateBtn.addEventListener("click", function() { debugLog("Regenerate click"); regenerateLast(); });';
  html += 'if (copyAllBtn) copyAllBtn.addEventListener("click", function() { debugLog("CopyAll click"); copyAllAssistantMessages(); });';
  html += 'if (undoBtn) undoBtn.addEventListener("click", function() { vscode.postMessage({ type: "restoreHistory" }); hideUndoSnackbar(); });';
  
  // Message handler
  html += 'window.addEventListener("message", function(event) {';
  html += '  var msg = event.data;';
  html += '  switch (msg.type) {';
  html += '    case "responseChunk":';
  html += '      currentResponse += msg.text;';
  html += '      updateLastAssistantMessage(currentResponse);';
  html += '      lastResponseActivityAt = Date.now();';
  html += '      armSendWatchdog(sendWatchdogMs);';
  html += '      break;';
  html += '    case "responseDone":';
  html += '      clearSendWatchdog();';
  html += '      clearPipelineMessages();';
  html += '      clearSendWatchdog();';
  html += '      setBusy(false);';
  html += '      setBusy(false);';
  html += '      break;';
  html += '    case "responseStopped":';
  html += '      clearSendWatchdog();';
  html += '      clearPipelineMessages();';
  html += '      if (currentResponse) { currentResponse += "\\n\\n[Zastaveno]"; updateLastAssistantMessage(currentResponse); }';
  html += '      setBusy(false);';
  html += '      break;';
  html += '    case "responseError":';
  html += '      clearSendWatchdog();';
  html += '      clearPipelineMessages();';
  html += '      var assistantMsgsErr = chat.querySelectorAll(".message.assistant:not(.pipeline)");';
  html += '      if (assistantMsgsErr.length > 0) assistantMsgsErr[assistantMsgsErr.length - 1].remove();';
  html += '      var errText = String(msg.text || "Neznama chyba").replace(/</g, "&lt;").replace(/>/g, "&gt;");';
  html += '      addMessageToUI("Chyba: " + errText, "assistant", false, Date.now());';
  html += '      setBusy(false);';
  html += '      break;';
  html += '    case "activeFileContent":';
  html += '      if (msg.text) {';
  html += '        var fileText = msg.text.length > 50000 ? msg.text.slice(0, 50000) + "\\n[Zkraceno]" : msg.text;';
  html += '        var fileName = String(msg.fileName || "soubor").replace(/[<>"]/g, "");';
  html += '        var tick = String.fromCharCode(96);';
  html += '        prompt.value = prompt.value + (prompt.value ? "\\n\\n" : "") + "Soubor " + fileName + ":\\n" + tick + tick + tick + "\\n" + fileText + "\\n" + tick + tick + tick;';
  html += '        prompt.dispatchEvent(new Event("input"));';
  html += '        prompt.focus();';
  html += '      } else { alert("??dn? aktivn? soubor"); }';
  html += '      break;';
  html += '    case "historyCleared":';
  html += '      messages = [];';
  html += '      renderMessages();';
  html += '      showUndoSnackbar("Historie vymazana - chces ji vratit?", 8000);';
  html += '      break;';
  html += '    case "historyRestored":';
  html += '      messages = msg.messages || [];';
  html += '      renderMessages();';
  html += '      addPipelineStatus("✅", "Historie obnovena", "approved", null, false);';
  html += '      break;';
  html += '    case "historyRestoreFailed":';
  html += '      addPipelineStatus("❌", "Obnoveni selhalo", "rejected", null, false);';
  html += '      break;';
  // Pipeline events - zobrazeni v chatu
  html += '    case "rozumPlanning":';
  html += '      addPipelineStatus("🧠", "Rozum planuje postup...", "planning", null, true);';
  html += '      break;';
  html += '    case "rozumPlanReady":';
  html += '      if (msg.plan) {';
  html += '        updatePipelineStatus("📋", "Plan: " + msg.plan.totalSteps + " kroku (" + msg.plan.complexity + ")", "planning");';
  html += '      }';
  html += '      break;';
  html += '    case "stepStart":';
  html += '      if (msg.step) {';
  html += '        addPipelineStatus(msg.step.emoji || "📦", msg.step.title, "step", "Krok " + msg.step.current + "/" + msg.step.total, true);';
  html += '      }';
  html += '      break;';
  html += '    case "stepComplete":';
  html += '      if (msg.step) {';
  html += '        updatePipelineStatus(msg.step.emoji || "✓", msg.step.title + " - hotovo", "step");';
  html += '      }';
  html += '      break;';
  html += '    case "stepReview":';
  html += '      if (msg.step) {';
  html += '        var reviewIcon = msg.approved ? "✅" : "🔄";';
  html += '        var reviewText = msg.approved ? "Rozum schv?lil" : "Rozum: " + (msg.feedback || "opakuji");';
  html += '        addPipelineStatus(reviewIcon, reviewText, msg.approved ? "approved" : "review", null, false);';
  html += '      }';
  html += '      break;';
  html += '    case "stepSvedomi":';
  html += '      if (msg.result) {';
  html += '        var svedIcon = msg.result.score >= 5 ? "✅" : "⚠️";';
  html += '        addPipelineStatus(svedIcon, "Svedomi: " + msg.result.score + "/10", msg.result.score >= 5 ? "approved" : "rejected", null, false);';
  html += '      }';
  html += '      break;';
  html += '    case "pipelineStatus":';
  html += '      addPipelineStatus(msg.icon || "ℹ️", msg.text, msg.statusType || "", msg.progress || null, msg.loading || false);';
  html += '      lastResponseActivityAt = Date.now();';
  html += '      armSendWatchdog(sendWatchdogMs);';
  html += '      break;';
  html += '    case "pipelineApproved":';
  html += '      clearPipelineMessages();';
  html += '      clearSendWatchdog();';
  html += '      setBusy(false);';
  html += '      addPipelineStatus("✅", "Odpov?? schv?lena!", "approved", null, false);';
  html += '      break;';
  html += '    case "guardianAlert":';
  html += '      addPipelineStatus("🛡️", msg.message, "validation", null, false);';
  html += '      break;';
  html += '    case "svedomiValidating":';
  html += '      addPipelineStatus("🧠", "Svedomi validuje...", "validation", null, true);';
  html += '      break;';
  html += '    case "svedomiValidationDone":';
  html += '      break;';
  html += '    case "guardianStatus":';
  html += '      if (!msg.result.isOk) {';
  html += '        statusDot.classList.add("guardian");';
  html += '        addPipelineStatus("🛡️", "Guardian: " + (msg.result.issues ? msg.result.issues.join(", ") : "Problem"), "rejected", null, false);';
  html += '      }';
  html += '      break;';
  html += '    case "miniModelResult":';
  html += '      if (msg.result) addPipelineStatus("📊", "Sk?re: " + msg.result.score + "/10 - " + msg.result.reason, msg.result.score >= 5 ? "approved" : "rejected", null, false);';
  html += '      break;';
  html += '    case "guardianStats":';
  html += '      showGuardianStatsModal(msg.stats);';
  html += '      break;';
  html += '    case "toolsStatus":';
  html += '      if (typeof msg.toolsEnabled === "boolean") toolsEnabled = msg.toolsEnabled;';
  html += '      if (typeof msg.confirmEdits === "boolean") safeMode = msg.confirmEdits;';
  html += '      updateSafeModeButton();';
  html += '      updateToolsStatus();';
  html += '      break;';
  html += '    case "toolEvent":';
  html += '      if (msg.name) { lastToolName = msg.name; updateToolsStatus(); }';
  html += '      lastResponseActivityAt = Date.now();';
  html += '      armSendWatchdog(sendWatchdogMs);';
  html += '      break;';
  html += '    case "toolWrite":';
  html += '      if (msg.path) {';
  html += '        lastWriteLabel = msg.path;';
  html += '        updateToolsStatus();';
  html += '        lastResponseActivityAt = Date.now();';
  html += '        armSendWatchdog(sendWatchdogMs);';
  html += '        var verb = msg.action === "created" ? "Soubor vytvořen" : "Soubor upraven";';
  html += '        showToolsToast(verb + ": " + msg.path);';
  html += '      }';
  html += '      break;';
  html += '    case "safeModeUpdated":';
  html += '      safeMode = !!msg.enabled;';
  html += '      updateSafeModeButton();';
  html += '      break;';
  html += '  }';
  html += '});';
  
  html += 'updateSafeModeButton();';
  html += 'updateToolsStatus();';
  html += 'renderMessages();';
  html += 'debugLog("Full webview script ready");';
  html += '</script>';
  html += '</body>';
  html += '</html>';
  
  return html;
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

// Export helpers for unit testing
export { ResponseGuardian, normalizeTaskWeight };




