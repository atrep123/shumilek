import * as vscode from 'vscode';
import { Logger } from './logger';
import * as path from 'path';
import { exec } from 'child_process';
import fetch, { Headers } from 'node-fetch';
import { fetchWithTimeout } from './fetchUtils';
import { streamPlainOllamaChat } from './responseStreaming';
import { executeModelCallWithMessages } from './modelCall';
import { runPostEditVerification } from './postEditVerification';
import {
  AirLLMStartupState,
  buildAirLLMStartCommandForExtension,
  ensureAirLLMRunning as ensureAirLLMRunningPure,
  startAirLLMServer as startAirLLMServerPure
} from './airllmRuntime';
import { 
  workspaceIndexer, 
  setWorkspaceLogger,
  ProjectMap
} from './workspace';
import { sanitizeMapSegment, formatProjectMapMarkdown } from './projectMap';
import { ContextProviderRegistry } from './contextProviders';
import { TurnOrchestrator } from './orchestration';
import { PIPELINE_STATUS_ICONS, PIPELINE_STATUS_TEXT } from './statusMessages';
import { getMiniUnavailableMessage, isMiniAccepted } from './validationPolicy';
import {
  runValidationPipeline as runValidationPipelinePure,
  ValidationPipelineConfig,
  ValidationPipelineResult,
  ValidationPipelineDeps,
  ToolSessionState,
  VerificationSummary,
  VerificationCommandResult
} from './validationPipeline';
import { 
  Rozum, 
  setRozumLogger, 
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
  GuardianStats,
  QualityCheckResult,
  ResponseHistoryEntry,
  AutoApprovePolicy,
  WebviewWrapper
} from './types';
import { buildCompressedMessages } from './contextMemory';
import { buildObsidianChatArchive, updateObsidianArchiveIndex } from './obsidianArchive';
import { humanizeApiError, isTransientError, isSafeUrl, normalizeTaskWeight, normalizeScore, pickBrainModel } from './utils';
import {
  getLastAssistantMessage,
  extractPreferredFencedCodeBlock,
  sanitizeChatMessages,
  formatQualityReport,
  buildStructuredOutput,
  normalizeExternalScore
} from './chatPersistence';
import { isSlashCommand, executeSlashCommand, SlashCommandContext } from './slashCommands';
import { runDoctorChecks, formatDoctorReport } from './doctor';
import { ModelRouter } from './modelRouter';
import { compactMessages } from './sessionCompactor';
import { loadWorkspaceInstructionBundle, setWorkspaceInstructionsLogger } from './workspaceInstructions';
import { ChatRequestConcurrencyGuard } from './chatConcurrency';
import { getWebviewContent } from './webviewContent';
import { computeRetryDecision, buildRetryFeedbackMessage, checkFailClosedBlock } from './retryDecision';
import { runToolCall } from './toolExecution';
import { generateWithTools } from './toolGeneration';
import { PixelLabLocalBridgeServer } from './pixellabBridge';
import {
  parseServerUrl,
  resolveExecutionMode,
  resolveModelPreset,
  clampNumber,
  getContextTokens,
  getMaxOutputTokens,
  getToolsEnabledSetting,
  getSafeModeSetting,
  getToolsAutoOpenAutoSaveSetting,
  getToolsAutoOpenOnWriteSetting,
  getToolsWriteToastSetting,
  toggleToolsEnabledSetting,
  toggleSafeModeSetting,
  resolveChatConfig
} from './configResolver';
import {
  MutationHandlerDeps
} from './toolHandlers';
import {
  BINARY_EXTENSIONS,
  asString,
  getFirstStringArg,
  normalizeExtension,
  buildAutoFileName,
  normalizeRouteText,
  tokenizeRouteText,
  computeContentHash,
  isBinaryExtension,
  readFileForTool
} from './fileUtils';
import {
  serializeRange,
  serializeSymbolKind,
  getPositionFromArgs,
  serializeLocationInfo,
  renderHoverContents,
  serializeDiagnosticSeverity,
  resolveSymbolPosition
} from './lspSerializer';
import {
  detectEol,
  splitLines,
  parseUnifiedDiff,
  applyUnifiedDiffToText
} from './diffUtils';
import {
  DEFAULT_EXCLUDE_GLOB,
  isWithinWorkspace,
  isFileNotFoundError,
  getRelativePathForWorkspace,
  getActiveWorkspaceFileUri,
  buildEditorContext
} from './contextBuilder';
import {
  ToolResult,
  EditorPlan,
  buildToolOnlyPrompt,
  buildEditorFirstInstructions,
  sanitizeEditorAnswer,
  buildEditorStateMessage,
  parseEditorPlanResponse,
  getToolRequirements,
  getStepToolRequirements
} from './toolUtils';
// (Types imported from ./types)

// Webview message types
interface WebviewMessage {
  type: string;
  prompt?: string;
  text?: string;
  [key: string]: unknown;
}

// External validator payload
interface ValidatorPayload {
  prompt: string;
  response: string;
  context?: string;
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
let pixelLabBridgeServer: PixelLabLocalBridgeServer | undefined;
const airllmStartupState: AirLLMStartupState = {};

function toAsciiLog(value: string): string {
  const input = String(value);
  const normalized = input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const asciiOnly = normalized.replace(/[^\x00-\x7F]/g, '');
  return asciiOnly;
}

async function startAirLLMServer(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('shumilek');
  await startAirLLMServerPure(context.extensionUri.fsPath, config, airllmStartupState, {
    createTerminal: () => vscode.window.createTerminal({ name: 'Shumilek AirLLM' }),
    now: () => Date.now(),
    log: message => outputChannel?.appendLine(message)
  });
}

async function ensureAirLLMRunning(
  context: vscode.ExtensionContext,
  baseUrl: string,
  autoStart: boolean,
  waitForHealthySeconds: number,
  panel?: WebviewWrapper
): Promise<boolean> {
  return ensureAirLLMRunningPure({
    baseUrl,
    autoStart,
    waitForHealthySeconds,
    panel,
    startServer: () => startAirLLMServer(context)
  }, airllmStartupState, {
    fetchFn: fetchWithTimeout,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    now: () => Date.now()
  });
}
// Keep messages in module scope so we can safely refresh the webview HTML even
// when the panel already exists (retainContextWhenHidden=true), without breaking
// the message handler's reference.
let chatMessages: ChatMessage[] = [];
const chatRequestGuard = new ChatRequestConcurrencyGuard();
let guardianStats: GuardianStats = {
  totalChecks: 0,
  loopsDetected: 0,
  repetitionsFixed: 0,
  retriesTriggered: 0,
  miniModelValidations: 0,
  miniModelRejections: 0,
  hallucinationsDetected: 0,
  similarResponsesBlocked: 0,
  truncationsRepaired: 0
};

// Backup for clear/undo flow
let lastClearedMessages: ChatMessage[] | undefined;
let lastClearedAt: number | undefined;

// Response history for similarity detection
let responseHistory: ResponseHistoryEntry[] = [];
const MAX_HISTORY_SIZE = 20;
const lastReadHashes = new Map<string, { hash: string; updatedAt: number }>();

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

function postToAllWebviews(message: unknown): void {
  try {
    currentPanel?.webview.postMessage(message as WebviewMessage);
  } catch {
    // ignore
  }
  try {
    sidebarView?.webview.postMessage(message as WebviewMessage);
  } catch {
    // ignore
  }
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
    let text: string;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      text = await res.text();
    } finally {
      clearTimeout(timeout);
    }
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

// Model router for intelligent failover (OpenClaw-inspired)
let modelRouter: ModelRouter | undefined;

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
    await handleWebviewMessage(wrapView(this._view), this._context, msg, chatMessages);
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
  Logger.initialize(context, outputChannel);
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
  setRozumLogger({ appendLine: (msg: string) => Logger.info(msg) } as any);
  setGuardianLogger((msg: string) => Logger.info(msg));
  setGuardianStats(guardianStats);
  setHallucinationLogger((msg: string) => Logger.info(msg));
  setSvedomiLogger(outputChannel);
  setSvedomiStats(guardianStats);
  setWorkspaceInstructionsLogger((msg: string) => outputChannel?.appendLine(msg));

  pixelLabBridgeServer = new PixelLabLocalBridgeServer(
    () => (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath),
    { log: message => outputChannel?.appendLine(message) }
  );
  void pixelLabBridgeServer.start().catch(error => {
    outputChannel?.appendLine(`[PixelLab] Bridge start failed: ${String(error)}`);
  });
  context.subscriptions.push({
    dispose: () => {
      const server = pixelLabBridgeServer;
      pixelLabBridgeServer = undefined;
      void server?.dispose();
    }
  });

  // Load persisted history (sanitize to prevent corrupted state from breaking the webview)
  chatMessages.length = 0;
  chatMessages.push(...loadChatMessages(context));
  outputChannel.appendLine(`[Init] Loaded ${chatMessages.length} message(s) from history`);

  // Initialize model router for intelligent failover (OpenClaw-inspired)
  {
    const initBaseUrl = parseServerUrl(config.get<string>('baseUrl', 'http://localhost:11434'), 'http://localhost:11434').baseUrl;
    const initModels = config.get<string[]>('brainModels', []) ?? [];
    const mainModel = config.get<string>('model', 'deepseek-coder-v2:16b');
    const allModels = [mainModel, ...initModels.filter(m => m !== mainModel)];
    modelRouter = new ModelRouter({ baseUrl: initBaseUrl, models: allModels });
    outputChannel.appendLine(`[Init] ModelRouter initialized with ${allModels.length} model(s)`);
  }

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
    if (terminal === airllmStartupState.terminal) {
      airllmStartupState.terminal = undefined;
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
      await handleWebviewMessage(wrapPanel(currentPanel), context, msg, chatMessages);
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

  // Command: Export full chat history into Obsidian-friendly markdown archive
  const exportHistoryToObsidianCmd = vscode.commands.registerCommand('shumilek.exportHistoryToObsidian', async () => {
    if (chatMessages.length === 0) {
      vscode.window.showWarningMessage('Sumilek: Neni co archivovat (historie je prazdna).');
      return;
    }

    const folder = getWorkspaceFolderForAutoSave();
    const archive = buildObsidianChatArchive(chatMessages, {
      projectName: folder?.name
    });
    const archiveDir = getObsidianArchiveDir();
    const defaultUri = folder
      ? vscode.Uri.joinPath(folder.uri, ...archiveDir.split(/[\\/]+/).filter(Boolean), archive.fileName)
      : undefined;

    if (folder) {
      const archiveFolderUri = vscode.Uri.joinPath(folder.uri, ...archiveDir.split(/[\\/]+/).filter(Boolean));
      await vscode.workspace.fs.createDirectory(archiveFolderUri);
    }

    const uri = await vscode.window.showSaveDialog({
      saveLabel: 'Ulozit archiv pro Obsidian',
      defaultUri,
      filters: {
        'Markdown': ['md'],
        'All files': ['*']
      }
    });
    if (!uri) return;

    await vscode.workspace.fs.writeFile(uri, Buffer.from(archive.markdown, 'utf8'));

    if (folder) {
      const indexPath = getObsidianArchiveIndexPath();
      const indexUri = vscode.Uri.joinPath(folder.uri, ...indexPath.split(/[\\/]+/).filter(Boolean));
      const indexParentUri = vscode.Uri.file(path.dirname(indexUri.fsPath));
      await vscode.workspace.fs.createDirectory(indexParentUri);

      let existingIndex = '';
      try {
        const bytes = await vscode.workspace.fs.readFile(indexUri);
        existingIndex = Buffer.from(bytes).toString('utf8');
      } catch {
        // Index does not exist yet.
      }

      const archiveRelativePath = path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
      const updatedIndex = updateObsidianArchiveIndex(existingIndex, {
        archivePath: archiveRelativePath,
        title: archive.title,
        createdAt: archive.createdAt,
        messageCount: archive.stats.totalMessages,
        projectName: archive.projectName
      });
      await vscode.workspace.fs.writeFile(indexUri, Buffer.from(updatedIndex, 'utf8'));
      outputChannel?.appendLine(`[Archive] Updated Obsidian archive index: ${indexUri.fsPath}`);
    }

    outputChannel?.appendLine(`[Archive] Saved Obsidian history archive: ${uri.fsPath}`);
    vscode.window.showInformationMessage(`Sumilek: Archiv historie ulozen (${archive.stats.totalMessages} zprav).`);
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

  // Command: Doctor diagnostics (OpenClaw-inspired)
  const doctorCmd = vscode.commands.registerCommand('shumilek.doctor', async () => {
    const cfg = vscode.workspace.getConfiguration('shumilek');
    const preset = resolveModelPreset(cfg.get<string>('modelPreset', 'custom'));
    const bUrl = parseServerUrl(cfg.get<string>('baseUrl', 'http://localhost:11434'), 'http://localhost:11434').baseUrl;
    const report = await runDoctorChecks({
      baseUrl: bUrl,
      mainModel: cfg.get<string>('model', preset?.model ?? 'deepseek-coder-v2:16b'),
      writerModel: cfg.get<string>('writerModel', preset?.writerModel ?? ''),
      rozumModel: cfg.get<string>('rozumModel', preset?.rozumModel ?? 'deepseek-r1:8b'),
      svedomiModel: cfg.get<string>('miniModel', preset?.miniModel ?? 'qwen2.5:3b')
    });
    const md = formatDoctorReport(report);
    outputChannel?.appendLine(md);
    // Show in webview if available
    const response = md;
    if (currentPanel) {
      currentPanel.webview.postMessage({ type: 'response', text: response });
    } else if (sidebarView) {
      sidebarView.webview.postMessage({ type: 'response', text: response });
    } else {
      vscode.window.showInformationMessage(report.ok ? '🩺 Doctor: Vše OK' : '🩺 Doctor: Nalezeny problémy — viz Output panel');
    }
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
  setWorkspaceLogger({ appendLine: (msg: string) => Logger.info(msg) } as any);

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
    openChatCmd, startAirLLMCmd, switchBackendCmd, clearHistoryCmd, guardianStatsCmd, doctorCmd, addTaskCmd, viewTasksCmd,
    scanWorkspaceCmd, showWorkspaceInfoCmd, exportLastResponseCmd, exportHistoryToObsidianCmd, applyLastResponseCmd,
    toggleToolsEnabledCmd, toggleToolsConfirmEditsCmd,
    ...projectMapWatchers
  );
}

export function deactivate() {
  if (abortController) {
    abortController.abort();
    abortController = undefined;
  }
  if (projectMapUpdateTimer) {
    clearTimeout(projectMapUpdateTimer);
    projectMapUpdateTimer = undefined;
  }
  const server = pixelLabBridgeServer;
  pixelLabBridgeServer = undefined;
  void server?.dispose();
  if (outputChannel) {
    outputChannel.dispose();
  }
}

// ============================================================
// CHAT HANDLER WITH GUARDIAN
// ============================================================

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

// Shared message handler for both sidebar and panel webviews
async function handleWebviewMessage(
  wrapper: WebviewWrapper,
  context: vscode.ExtensionContext,
  msg: WebviewMessage,
  messages: ChatMessage[]
): Promise<void> {
  switch (msg.type) {
    case 'debugLog':
      outputChannel?.appendLine(`[Webview] ${String(msg.text ?? '')}`);
      break;

    case 'chat':
      if (msg.prompt) {
        await handleChatInternal(wrapper, context, msg.prompt, messages);
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
      wrapper.webview.postMessage({
        type: 'activeFileContent',
        text: content,
        fileName
      });
      break;

    case 'clearHistory':
      lastClearedMessages = messages.slice();
      lastClearedAt = Date.now();
      messages.length = 0;
      guardian.resetHistory();
      await saveChatMessages(context, messages);
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

        messages.length = 0;
        messages.push(...lastClearedMessages);
        try {
          await saveChatMessages(context, messages);
          postToAllWebviews({ type: 'historyRestored', messages });
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
      wrapper.webview.postMessage({
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

// === VALIDATION PIPELINE (delegates to validationPipeline.ts) ===

function getValidationPipelineDeps(): ValidationPipelineDeps {
  return {
    postToAllWebviews,
    log: (msg: string) => outputChannel?.appendLine(msg),
    guardianStats,
    hallucinationDetector,
    guardian,
    responseHistoryManager,
    svedomi,
    generateWithTools: (
      panel,
      baseUrl,
      model,
      systemPrompt,
      messages,
      timeout,
      maxIterations,
      confirmEdits,
      requirements,
      options,
      abortSignal,
      session,
      autoApprovePolicy
    ) => generateWithTools(
      panel,
      baseUrl,
      model,
      systemPrompt,
      messages,
      timeout,
      maxIterations,
      confirmEdits,
      {
        log: (msg) => outputChannel?.appendLine(msg),
        postToAllWebviews,
        getMutationHandlerDeps
      },
      requirements,
      options,
      abortSignal,
      session,
      autoApprovePolicy
    ),
    runPostEditVerification,
    runExternalValidators,
    summarizeResponse,
    buildStructuredOutput,
    getMiniUnavailableMessage,
    isMiniAccepted
  };
}

async function runValidationPipeline(
  fullResponse: string,
  toolSession: ToolSessionState,
  cfg: ValidationPipelineConfig
): Promise<ValidationPipelineResult | null> {
  return runValidationPipelinePure(fullResponse, toolSession, cfg, getValidationPipelineDeps());
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
  const chatCfg = resolveChatConfig(config);
  let {
    baseModel, writerModel, brainModels, miniModel, rozumModel, summarizerModel,
    baseUrl, maxRetries
  } = chatCfg;
  const {
    systemPrompt, timeout, pipelineAlwaysOn, useAirLLM,
    airllmAutoStart, airllmWaitForHealthy, guardianEnabled, miniModelEnabled,
    configuredExecutionMode, validationPolicy, autoApprovePolicy,
    contextProviderNames, contextProviderTokenBudget, stepTimeout, toolsEnabled,
    toolsConfirmEdits, effectiveAutoSteps, workspaceIndexEnabled,
    validatorLogsEnabled, summarizerEnabled, rewardEnabled, rewardEndpoint,
    rewardThreshold, hhemEnabled, hhemEndpoint, hhemThreshold, ragasEnabled,
    ragasEndpoint, ragasThreshold, modelPreset
  } = chatCfg;
  if (chatCfg.modelPreset !== 'custom' && resolveModelPreset(chatCfg.modelPreset)) {
    outputChannel?.appendLine(`[Models] Preset applied: ${modelPreset}`);
  }

  // ModelRouter: update models and apply failover if primary is backed off
  if (modelRouter) {
    const allModels = [writerModel, ...brainModels.filter(m => m !== writerModel)];
    modelRouter.updateModels(allModels);
    const picked = modelRouter.pick();
    if (picked !== writerModel) {
      outputChannel?.appendLine(`[ModelRouter] Failover: ${writerModel} → ${picked}`);
      writerModel = picked;
    }
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

  const workspaceInstructionBundle = await loadWorkspaceInstructionBundle();

  // === SLASH COMMANDS (OpenClaw-inspired) ===
  if (retryCount === 0 && isSlashCommand(trimmedPrompt)) {
    outputChannel?.appendLine(`[SlashCmd] Handling: ${trimmedPrompt}`);
    messages.push({ role: 'user', content: trimmedPrompt, timestamp: Date.now() });
    const slashCtx: SlashCommandContext = {
      messages,
      guardianStats,
      modelInfo: {
        main: baseModel,
        writer: writerModel,
        rozum: rozumModel,
        svedomi: miniModel,
        backend: useAirLLM ? 'airllm' : 'ollama',
        baseUrl
      },
      orchestrationState: 'idle',
      svedomiCacheSize: 0,
      responseHistoryStats: responseHistoryManager.getStats(),
      saveMessages: () => saveChatMessages(context, messages),
      resetGuardian: () => guardian.resetHistory(),
      runDoctor: async () => {
        const report = await runDoctorChecks({
          baseUrl,
          mainModel: baseModel,
          writerModel,
          rozumModel,
          svedomiModel: miniModel
        });
        return formatDoctorReport(report);
      },
      compactSession: async () => {
        const result = compactMessages(messages);
        if (result.compacted) {
          messages.length = 0;
          messages.push(...result.messages);
          await saveChatMessages(context, messages);
        }
        return { compacted: result.compacted, saved: result.saved };
      },
      toolsInfo: {
        enabled: toolsEnabled,
        confirmEdits: toolsConfirmEdits,
        autoApprove: autoApprovePolicy ?? {
          read: true,
          edit: false,
          commands: false,
          browser: false,
          mcp: false
        }
      },
      getWorkspaceInstructions: async () => ({
        files: workspaceInstructionBundle.files.map(file => file.path),
        totalChars: workspaceInstructionBundle.files.reduce((sum, file) => sum + file.includedChars, 0),
        truncated: workspaceInstructionBundle.files.some(file => file.truncated)
      })
    };
    const slashResult = await executeSlashCommand(trimmedPrompt, slashCtx);
    if (slashResult.handled) {
      if (slashResult.clearHistory) {
        lastClearedMessages = messages.slice();
        lastClearedAt = Date.now();
        messages.length = 0;
        guardian.resetHistory();
        await saveChatMessages(context, messages);
        postToAllWebviews({ type: 'historyCleared' });
      }
      if (slashResult.response) {
        messages.push({ role: 'assistant', content: slashResult.response, timestamp: Date.now() });
        await saveChatMessages(context, messages);
        panel.webview.postMessage({ type: 'response', text: slashResult.response });
      }
      return;
    }
  }

  if (!chatRequestGuard.tryAcquire(retryCount)) {
    panel.webview.postMessage({
      type: 'responseError',
      text: 'Jiný dotaz se stále zpracovává. Počkejte prosím na dokončení.'
    });
    return;
  }

  // Only add user message on first attempt
  if (retryCount === 0) {
    messages.push({ role: 'user', content: trimmedPrompt, timestamp: Date.now() });
  }

  // Create AbortController early so both step-by-step and single-call paths have it
  const localAbortController = new AbortController();
  abortController = localAbortController;

  /** Release guard + clear abort on any exit after tryAcquire */
  const releaseGuardAndAbort = () => {
    chatRequestGuard.release(retryCount);
    if (abortController === localAbortController) {
      abortController = undefined;
    }
  };

  if (useAirLLM) {
    const ready = await ensureAirLLMRunning(context, baseUrl, airllmAutoStart, airllmWaitForHealthy, panel);
    if (!ready) {
      panel.webview.postMessage({
        type: 'responseError',
        text: 'AirLLM server is not ready. Start it and retry.'
      });
      releaseGuardAndAbort();
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

  // === WORKSPACE INSTRUCTIONS (AGENTS.md pattern, OpenClaw-inspired) ===
  const workspaceInstructions = workspaceInstructionBundle.text;

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
- Dokumentuj své kroky a zjištění${retryFeedbackSection}${workspaceInstructions}${workspaceContext}`;

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
    ? await buildEditorContext(trimmedPrompt, context, workspaceIndexEnabled, ensureProjectMap, getActiveWorkspaceFileUri())
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
            const stepRequirements = getStepToolRequirements(stepInfo.type, stepInfo.instruction);
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
              {
                log: (msg) => outputChannel?.appendLine(msg),
                postToAllWebviews,
                getMutationHandlerDeps
              },
              stepRequirements,
              {
                forceJson: stepRequirements.requireToolCall,
                systemPromptOverride: stepToolOnlyPrompt,
                primaryModel: toolPrimaryModel,
                fallbackModel: toolsFallbackModel
              },
              abortController?.signal,
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
            stepTimeout,
            abortController?.signal
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

      orchestrator.transition('verify', { stepMode: true, hadMutations: toolSession.hadMutations });

      const vResult = await runValidationPipeline(fullResponse, toolSession, {
        trimmedPrompt, chatMessages, stepMode: true, panel,
        toolCallsEnabled, baseUrl, writerModel, toolPromptForMain,
        toolPrimaryModel, toolsFallbackModel, toolsConfirmEdits,
        stepTimeout, autoApprovePolicy, abortSignal: abortController?.signal,
        guardianEnabled, miniModelEnabled, validationPolicy,
        validatorLogsEnabled, summarizerEnabled, summarizerModel, timeout,
        rewardEnabled, rewardEndpoint, rewardThreshold,
        hhemEnabled, hhemEndpoint, hhemThreshold,
        ragasEnabled, ragasEndpoint, ragasThreshold,
      });
      if (!vResult) {
        postToAllWebviews({ type: 'responseDone' });
        releaseGuardAndAbort();
        return; // blocked by fail-closed verification
      }

      // Step-mode: unified fail-closed check (hallucination, guardian, svedomi, external validators)
      const failClosedBlock = checkFailClosedBlock({
        hallucinationResult: vResult.hallucinationResult,
        guardianResult: vResult.guardianResult,
        miniResult: vResult.miniResult,
        validationPolicy,
        rewardEnabled,
        rewardResult: vResult.external.rewardResult,
        hhemEnabled,
        hhemResult: vResult.external.hhemResult,
        ragasEnabled,
        ragasResult: vResult.external.ragasResult,
      });
      if (failClosedBlock.blocked) {
        outputChannel?.appendLine(`[FailClosed/StepMode] Blocking publish: ${failClosedBlock.reason}`);
        postToAllWebviews({
          type: 'responseError',
          text: `Publish blocked: ${failClosedBlock.reason}`
        });
        postToAllWebviews({ type: 'responseDone' });
        releaseGuardAndAbort();
        return;
      }

      fullResponse = vResult.structuredOutput;
      const appendix = buildStructuredOutput('', vResult.summary, vResult.qualityChecks, false).trim();
      if (appendix) {
        postToAllWebviews({ type: 'responseChunk', text: `\n\n${appendix}` });
      }
      
      postToAllWebviews({ type: 'rozumPlanningDone' });
      postToAllWebviews({ type: 'allStepsComplete', totalSteps: rozumPlan!.totalSteps });
      
      orchestrator.transition('publish', { stepMode: true, checkpoints: orchestrator.getCheckpoints().length });
      postToAllWebviews({ type: 'pipelineApproved', message: 'Odpoved schvalena Rozumem a validaci' });
      postToAllWebviews({ type: 'responseChunk', text: fullResponse });

      outputChannel?.appendLine('');
      outputChannel?.appendLine(`[Pipeline] Celkem kroků: ${rozumPlan.totalSteps}, dokončeno: ${stepResults.length}`);

      messages.push({ role: 'assistant', content: fullResponse, timestamp: Date.now() });
      await saveChatMessages(context, messages);
      const finalScore = vResult.miniResult?.score || 7;
      responseHistoryManager.addResponse(vResult.fullResponse, trimmedPrompt, finalScore);

      postToAllWebviews({ type: 'responseDone' });

      releaseGuardAndAbort();
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
  const contextTokens = getContextTokens();
  const { apiMessages, compressed: compressionResult } = buildCompressedMessages(
    toolSystemPrompt,
    messages,
    contextTokens
  );
  if (compressionResult.wasCompressed) {
    outputChannel?.appendLine(
      `[ContextMemory] Compressed: ${compressionResult.stats.originalCount} msgs -> ` +
      `${compressionResult.stats.summarizedCount} summarized + ${compressionResult.stats.recentCount} recent ` +
      `(~${compressionResult.stats.estimatedTokensSaved} tokens saved)`
    );
  }

  const url = `${baseUrl}/api/chat`;

  let fullResponse = '';
  let streamedToUi = false;
  const generationStartMs = Date.now();

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
        {
          log: (msg) => outputChannel?.appendLine(msg),
          postToAllWebviews,
          getMutationHandlerDeps
        },
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
      fullResponse = await streamPlainOllamaChat({
        url,
        model: writerModel,
        apiMessages,
        timeout,
        panel,
        abortCtrl: localAbortController,
        guardianEnabled,
        log: (msg) => outputChannel?.appendLine(msg)
      });
    }

    orchestrator.transition('verify', { stepMode: false, hadMutations: toolSession.hadMutations });

    // Record successful generation in ModelRouter for failover tracking
    if (modelRouter && fullResponse) {
      modelRouter.recordSuccess(writerModel, Date.now() - generationStartMs);
    }

    if (fullResponse) {
      const vResult = await runValidationPipeline(fullResponse, toolSession, {
        trimmedPrompt, chatMessages, stepMode: false, panel,
        toolCallsEnabled, baseUrl, writerModel, toolPromptForMain,
        toolPrimaryModel, toolsFallbackModel, toolsConfirmEdits,
        stepTimeout, autoApprovePolicy, abortSignal: abortController?.signal,
        guardianEnabled, miniModelEnabled, validationPolicy,
        validatorLogsEnabled, summarizerEnabled, summarizerModel, timeout,
        rewardEnabled, rewardEndpoint, rewardThreshold,
        hhemEnabled, hhemEndpoint, hhemThreshold,
        ragasEnabled, ragasEndpoint, ragasThreshold,
      });
      if (!vResult) return; // blocked by fail-closed verification

      // === UNIFIED RETRY LOGIC (single-call only) ===
      const { hallucinationResult, guardianResult, miniResult, external } = vResult;
      const { rewardResult, hhemResult, ragasResult } = external;

      const retryDecision = computeRetryDecision({
        hallucinationResult, guardianResult, miniResult,
        rewardResult, hhemResult, ragasResult,
        validationPolicy, guardianEnabled,
        rewardEnabled, rewardThreshold,
        hhemEnabled, hhemThreshold,
        ragasEnabled, ragasThreshold,
        toolsHadMutations: toolSession.hadMutations,
        toolsEnabled,
        retryCount, maxRetries
      });

      if (retryDecision.shouldRetry) {
        const retryFeedbackMessage = buildRetryFeedbackMessage(
          retryDecision, hallucinationResult, guardianResult, miniResult,
          guardianEnabled, hallucinationDetector.getSummary(hallucinationResult)
        );

        outputChannel?.appendLine(`[Retry] Spoustim retry - duvod: ${retryDecision.retrySource}`);
        guardianStats.retriesTriggered++;

        postToAllWebviews({
          type: 'guardianAlert',
          message: `🔄 ${retryDecision.retrySource}: ${retryDecision.retryDetail}. Zkouším znovu (${retryCount + 1}/${maxRetries})`
        });

        if (messages[messages.length - 1]?.role === 'assistant') {
          messages.pop();
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        return handleChatInternal(panel, context, trimmedPrompt, messages, retryCount + 1, retryFeedbackMessage);
      }
      if (retryDecision.blocked) {
        outputChannel?.appendLine(`[Retry] Skipping retry because ${retryDecision.blockedReason}`);
        const failBlock = checkFailClosedBlock({
          hallucinationResult, guardianResult, miniResult, validationPolicy,
          rewardEnabled, rewardResult, hhemEnabled, hhemResult, ragasEnabled, ragasResult,
        });
        if (failBlock.blocked) {
          postToAllWebviews({ type: 'responseError', text: `Publish blocked: ${failBlock.reason}` });
          return;
        }
      }

      // Fail-closed: unified block check for validators
      const failClosedCheck = checkFailClosedBlock({
        hallucinationResult, guardianResult, miniResult, validationPolicy,
        rewardEnabled, rewardResult, hhemEnabled, hhemResult, ragasEnabled, ragasResult,
      });
      if (failClosedCheck.blocked) {
        outputChannel?.appendLine(`[FailClosed] Blocking publish: ${failClosedCheck.reason}`);
        postToAllWebviews({
          type: 'responseError',
          text: `Publish blocked: ${failClosedCheck.reason}`
        });
        return;
      }

      fullResponse = vResult.structuredOutput;

      orchestrator.transition('publish', { stepMode: false, checkpoints: orchestrator.getCheckpoints().length });
      postToAllWebviews({ type: 'pipelineApproved', message: '✅ Odpověď schválena' });

      const finalScore = miniResult?.score || 7;
      responseHistoryManager.addResponse(vResult.fullResponse, trimmedPrompt, finalScore);
    }

    if (!streamedToUi && fullResponse) {
      postToAllWebviews({ type: 'responseChunk', text: fullResponse });
    }

    messages.push({ role: 'assistant', content: fullResponse, timestamp: Date.now() });
    await saveChatMessages(context, messages);

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
      // Record failure in ModelRouter for failover tracking
      if (modelRouter) {
        modelRouter.recordFailure(writerModel, error.message || String(err));
      }
      // Auto-retry transient API errors (ECONNRESET, ETIMEDOUT, 5xx, etc.)
      if (isTransientError(error) && retryCount < maxRetries) {
        const backoffMs = 1000 * Math.pow(2, retryCount); // 1s, 2s, 4s...
        outputChannel?.appendLine(`[Retry] Transient error detected: ${error.message}. Retrying in ${backoffMs}ms (${retryCount + 1}/${maxRetries})`);
        postToAllWebviews({
          type: 'guardianAlert',
          message: `🔄 Přechodná chyba sítě — zkouším znovu (${retryCount + 1}/${maxRetries})...`
        });
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        return handleChatInternal(panel, context, trimmedPrompt, messages, retryCount + 1);
      }
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
      const rawMsg = error.message || String(err);
      const errorMsg = humanizeApiError(rawMsg);
      outputChannel?.appendLine(`[Error] ${rawMsg}`);
      // Only send error if panel is still valid
      postToAllWebviews({ type: 'responseError', text: errorMsg });
    }
  } finally {
    releaseGuardAndAbort();
    outputChannel?.appendLine(`[Orchestrator] State: ${orchestrator.getCurrent()} | checkpoints=${orchestrator.getCheckpoints().length}`);
  }
}

// ============================================================
// UTILITIES
// ============================================================

const DEFAULT_MAX_LIST_RESULTS = 200;
const DEFAULT_MAX_SEARCH_RESULTS = 20;
const DEFAULT_MAX_LSP_RESULTS = 200;
const DEFAULT_MAX_READ_LINES = 400;
const DEFAULT_MAX_READ_BYTES = 256 * 1024;
const DEFAULT_MAX_WRITE_BYTES = 256 * 1024;

function buildToolInstructions(): string {
  const autoSaveDir = getToolsAutoSaveDir();
  return [
    'TOOLING:',
    'You have access to tools for file operations and terminal execution. Use tools when you need to read, edit files or run commands.',
    'Tool call format (return ONLY tool_call blocks, without conversational text):',
    '<tool_call>{"name":"read_file","arguments":{"path":"src/extension.ts","startLine":1,"endLine":200}}</tool_call>',
    'After each tool call, you will receive a result:',
    '<tool_result>{"ok":true,"tool":"read_file","data":{...}}</tool_result>',
    'read_file caches the file hash; ALWAYS use read_file before replace_lines.',
    `Auto-save folder: ${autoSaveDir}.`,
    'If you do not know the path, use pick_save_path and then write_file with the returned path.',
    'Use title/suggestedName/extension in pick_save_path for smart naming.',
    'If path is omitted in write_file/replace_lines, the active file is used. write_file without an active file saves to the auto-save folder.',
    'Decide the target file yourself: 1) explicit in query, 2) active file if relevant, 3) relevant context files, 4) list_files/search_in_files, 5) new file in auto-save.',
    'Do not ask for a path unless strictly necessary; make a decision and write.',
    'If the workspace is multi-root, use the format root/file.',
    '',
    'AVAILABLE TOOLS:',
    '- list_files { glob?: string, maxResults?: number }',
    '- read_file { path: string, startLine?: number, endLine?: number }',
    '- get_active_file { }',
    '- search_in_files { query: string, glob?: string, maxResults?: number, isRegex?: boolean }',
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
    '- run_terminal_command { command: string, timeoutMs?: number }',
    '- fetch_webpage { url: string }',
    '- browser_fetch_page { url: string }',
    '- browser_open_page { url: string }',
    '',
    'RULES:',
    '- When editing, read the file first and use replace_lines with precise line content matches.',
    '- Never report having read/modified a file without getting a tool_result back first.',
    '- If you receive a tool_result with approved:false, suggest an alternative or ask the user.',
    '- Wait for terminal command output before proceeding to next steps.'
  ].join('\n');
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
    const result = await runToolCall(panel, action, confirmEdits, session, autoApprovePolicy, {
      log: (msg) => outputChannel?.appendLine(msg),
      postToAllWebviews,
      getMutationHandlerDeps
    });
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
        true,
        (msg) => outputChannel?.appendLine(msg)
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

function normalizeAutoSaveDir(raw: string, _folder?: vscode.WorkspaceFolder): string {
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

function getObsidianArchiveDir(): string {
  const config = vscode.workspace.getConfiguration('shumilek');
  const raw = config.get<string>('obsidianArchiveDir', 'notes/shumilek/archive');
  const folder = getWorkspaceFolderForAutoSave();
  return normalizeAutoSaveDir(raw, folder);
}

function getObsidianArchiveIndexPath(): string {
  const archiveDir = getObsidianArchiveDir();
  const fallback = path.join(archiveDir, 'ARCHIVE_INDEX.md');
  const config = vscode.workspace.getConfiguration('shumilek');
  const raw = config.get<string>('obsidianArchiveIndexPath', fallback);
  return sanitizeRelativePath(raw, fallback);
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

function getMutationHandlerDeps(): MutationHandlerDeps {
  return {
    DEFAULT_MAX_LSP_RESULTS,
    DEFAULT_MAX_READ_BYTES,
    DEFAULT_MAX_WRITE_BYTES,
    DEFAULT_MAX_LIST_RESULTS,
    DEFAULT_MAX_READ_LINES,
    DEFAULT_MAX_SEARCH_RESULTS,
    DEFAULT_EXCLUDE_GLOB,
    BINARY_EXTENSIONS,
    lastReadHashes,
    asString,
    clampNumber,
    getFirstStringArg,
    resolveWorkspaceUri,
    getActiveWorkspaceFileUri,
    readFileForTool,
    getRelativePathForWorkspace,
    getPositionFromArgs,
    resolveSymbolPosition,
    serializeLocationInfo: (loc: vscode.Location | vscode.LocationLink) => serializeLocationInfo(loc, getRelativePathForWorkspace),
    serializeRange,
    serializeSymbolKind,
    renderHoverContents,
    serializeDiagnosticSeverity,
    detectEol,
    splitLines,
    showDiffAndConfirm,
    applyFileContent,
    markToolMutation,
    recordToolWrite,
    computeContentHash,
    getToolsAutoOpenAutoSaveSetting,
    getToolsAutoOpenOnWriteSetting,
    isInAutoSaveDir,
    revealWrittenDocument,
    notifyToolWrite,
    parseUnifiedDiff,
    applyUnifiedDiffToText,
    isBinaryExtension,
    normalizeExtension,
    normalizeRouteText,
    tokenizeRouteText,
    buildAutoFileName,
    resolveAutoSaveTargetUri,
    isSafeUrl,
    openExternalUrl: async (raw: string) => Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(raw)))
  };
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
  _silentMode = true,
  stepTimeoutMs?: number,
  abortSignal?: AbortSignal
): Promise<string> {
  const url = `${baseUrl}/api/chat`;
  const controller = new AbortController();
  // Wire external abort signal to our internal controller
  if (abortSignal) {
    if (abortSignal.aborted) { controller.abort(); }
    else { abortSignal.addEventListener('abort', () => controller.abort(), { once: true }); }
  }
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

    // Don't clear timeout yet — keep it alive during streaming

    if (!res.ok || !res.body) {
      clearTimeout(timeoutId);
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';
    let lastChunkAt = Date.now();
    const STREAM_STALL_MS = 15000;

    for await (const chunk of res.body as any) {
      if (!chunk) continue;
      const now = Date.now();
      if (now - lastChunkAt > STREAM_STALL_MS && fullResponse.length > 50) {
        outputChannel?.appendLine('[executeModelCall] Stream stall detected, aborting');
        controller.abort();
        break;
      }
      lastChunkAt = now;
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
          // Ignore JSON parse errors
        }
      }
    }
    // Flush TextDecoder for any remaining multi-byte characters
    buffer += decoder.decode(new Uint8Array(), { stream: false });
    // Process any remaining content in buffer
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        if (parsed.message?.content) {
          fullResponse += parsed.message.content;
        }
      } catch {
        // Ignore JSON parse errors in trailing buffer
      }
    }
    clearTimeout(timeoutId);

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

// Export helpers for unit testing
export { ResponseGuardian, normalizeTaskWeight };

