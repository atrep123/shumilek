import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import fetch from 'node-fetch';

type BatchOptions = {
  scenarios: string[];
  runs: number;
  model: string;
  plannerModel?: string;
  reviewerModel?: string;
  jsonRepairModel?: string;
  deterministicFallbackMode: 'off' | 'on-fail' | 'always';
  timeoutSec: number;
  maxIterations: number;
  hardTimeoutSec?: number;
  stopOnInfraFailure: boolean;
  autoRestartOnInfraFailure: boolean;
  maxInfraRestarts: number;
  infraRestartTimeoutSec: number;
  infraRestartCooldownSec: number;
  infraRestartCommand?: string;
  ollamaBaseUrl: string;
  infraRecoveryTimeoutSec: number;
  infraRecoveryPollSec: number;
  outDir?: string;
};

type InfraFailureKind = 'ollama_unreachable' | 'ollama_model_missing';

type InfraFailureSignal = {
  kind: InfraFailureKind;
  message: string;
  source: 'validation' | 'run_log';
};

type InfraRecoveryResult = {
  recovered: boolean;
  attempts: number;
  elapsedMs: number;
};

type InfraRestartResult = {
  ok: boolean;
  elapsedMs: number;
  error?: string;
  command: string;
};

type DeterministicFallbackStats = {
  mode: 'off' | 'on-fail' | 'always';
  tsTodo: {
    activations: number;
    recoveries: number;
    targetedActivations: number;
    targetedRecoveries: number;
    canonicalActivations: number;
    canonicalRecoveries: number;
    rawPasses: number;
    rawFailures: number;
    recoveredByFallback: number;
  };
  tsCsv: {
    activations: number;
    recoveries: number;
    targetedActivations: number;
    targetedRecoveries: number;
    canonicalActivations: number;
    canonicalRecoveries: number;
    rawPasses: number;
    rawFailures: number;
    recoveredByFallback: number;
  };
  nodeApi: {
    activations: number;
    recoveries: number;
    targetedActivations: number;
    targetedRecoveries: number;
    canonicalActivations: number;
    canonicalRecoveries: number;
    rawPasses: number;
    rawFailures: number;
    recoveredByFallback: number;
  };
  totalActivations: number;
  totalRecoveries: number;
  totalTargetedActivations: number;
  totalTargetedRecoveries: number;
  totalCanonicalActivations: number;
  totalCanonicalRecoveries: number;
  totalRawPasses: number;
  totalRawFailures: number;
  totalRecoveredByFallback: number;
  fallbackDependencyRate: number;
};

type RunResult = {
  scenario: string;
  runIndex: number;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  outDir: string;
  diagnostics: string[];
  timedOut: boolean;
  parseStats: {
    plannerFailures: number;
    schemaFailures: number;
    jsonRepairFailures: number;
    parseFailures: number;
    jsonParseFailures: number;
    placeholderFailures: number;
    otherFailures: number;
  };
  deterministicFallback: DeterministicFallbackStats;
  infraFailure: InfraFailureSignal | null;
};

type FailureClusterCount = {
  id: string;
  count: number;
};

type SummaryRow = {
  scenario: string;
  pass: number;
  total: number;
  passRate: number;
  avgMs: number;
  runsWithPlannerError: number;
  runsWithJsonRepairError: number;
  jsonRepairErrorFiles: number;
  runsWithSchemaFailure: number;
  schemaFailures: number;
  runsWithJsonParseFailure: number;
  jsonParseFailures: number;
  runsWithPlaceholderFailure: number;
  placeholderFailures: number;
  runsWithOtherParseFailure: number;
  otherParseFailures: number;
  runsWithDeterministicFallback: number;
  deterministicFallbackActivations: number;
  deterministicFallbackRecoveries: number;
  deterministicFallbackTargetedActivations: number;
  deterministicFallbackTargetedRecoveries: number;
  deterministicFallbackCanonicalActivations: number;
  deterministicFallbackCanonicalRecoveries: number;
  rawPasses: number;
  rawFailures: number;
  rawPassRate: number | null;
  recoveredByFallback: number;
  fallbackDependencyRate: number;
  runsWithRawPass: number;
  runsRecoveredByFallback: number;
  rawRunPassRate: number;
  fallbackDependencyRunRate: number;
  topFailureClusters: FailureClusterCount[];
};

type BatchInfraAbortRecord = {
  scenario: string;
  runIndex: number;
  outDir: string;
  kind: InfraFailureKind;
  message: string;
  source: 'validation' | 'run_log';
  detectedAt: string;
};

type BatchErrorRecord = {
  name: string;
  message: string;
  stack?: string;
  occurredAt: string;
};

type RunSingleParams = {
  repoRoot: string;
  tsNodePath: string;
  opts: BatchOptions;
  scenario: string;
  runIndex: number;
  outDir: string;
};

type BatchRuntimeDeps = {
  repoRoot?: string;
  runSingle?: (params: RunSingleParams) => Promise<RunResult>;
};

const DEFAULT_BATCH_SCENARIOS = [
  'ts-todo-oracle',
  'node-api-oracle',
  'ts-csv-oracle',
  'python-ai-stdlib-oracle',
  'node-project-api-large'
];

function supportsExplicitRawMetricsForScenario(scenario: string): boolean {
  const value = String(scenario || '').trim().toLowerCase();
  return (
    value === 'ts-todo-oracle' ||
    value === 'node-api-oracle' ||
    value === 'node-api-repair-oracle' ||
    value === 'ts-csv-oracle' ||
    value === 'ts-csv-repair-oracle'
  );
}

function deriveRawOutcomeForRun(run: RunResult): {
  rawPasses: number;
  rawFailures: number;
  recoveredByFallback: number;
} {
  if (supportsExplicitRawMetricsForScenario(run.scenario)) {
    return {
      rawPasses: Number(run.deterministicFallback.totalRawPasses) || 0,
      rawFailures: Number(run.deterministicFallback.totalRawFailures) || 0,
      recoveredByFallback: Number(run.deterministicFallback.totalRecoveredByFallback) || 0
    };
  }

  return {
    rawPasses: run.ok ? 1 : 0,
    rawFailures: run.ok ? 0 : 1,
    recoveredByFallback: 0
  };
}

export function normalizeDeterministicFallbackMode(raw?: string): 'off' | 'on-fail' | 'always' {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'off' || value === 'always' || value === 'on-fail') return value;
  return 'on-fail';
}

export function classifyFailureCluster(message: string): string {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) return 'other';

  if (
    /\[infra:ollama_unreachable\]|cannot reach ollama|\/api\/tags failed|ollama request failed|start ollama server/.test(text)
  ) return 'ollama_infra';

  if (
    /\[infra:ollama_model_missing\]|requested model .* is not available|ollama pull/.test(text)
  ) return 'ollama_model_missing';

  if (
    /src\/store\.ts|src\/cli\.ts|taskstore|process\.argv|tsconfig\.json|typescript strict mode|dist\/cli\.js missing|dist\/store\.js missing/.test(text)
  ) return 'ts_contract';

  if (
    /src\/server\.js|createserver|openapi\.json|\/todos\/\{id\}|must not call listen|return server instance/i.test(text)
  ) return 'node_contract';

  if (
    /indentationerror|syntaxerror|traceback|mini_ai\/markov\.py|mini_ai\/cli\.py|python/i.test(text)
  ) return 'python_syntax';

  if (
    /missing "files" array|files\[\]|duplicate file paths|json root must be an object|mode" must be|notes" must be|full mode output missing required files/.test(text)
  ) return 'schema_shape';

  if (
    /unexpected token|unterminated string|unexpected end of json input|unexpected end of input|not valid json|after array element|position \d+/.test(text)
  ) return 'json_parse';

  if (
    /placeholder content detected|remaining part|rest of the file|rest of the code|file remains unchanged/.test(text)
  ) return 'placeholder';

  if (
    /non-builtin|no dependencies allowed|dependencies\/devdependencies|must not set "type": "module"|type": "module"/.test(text)
  ) return 'deps_policy';

  if (
    /command failed|exit=|timedout=|timed out|eaddrinuse|cannot find module|server startup failed|internal error/.test(text)
  ) return 'command_runtime';

  return 'other';
}

function addClusterCount(map: Map<string, number>, id: string, value = 1): void {
  if (!id || value <= 0) return;
  map.set(id, (map.get(id) || 0) + value);
}

function sortFailureClusters(map: Map<string, number>): FailureClusterCount[] {
  return [...map.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => (b.count - a.count) || a.id.localeCompare(b.id));
}

export function collectFailureClustersForRun(run: RunResult): FailureClusterCount[] {
  const clusters = new Map<string, number>();
  for (const diagnostic of run.diagnostics || []) {
    addClusterCount(clusters, classifyFailureCluster(diagnostic), 1);
  }
  if (run.timedOut) addClusterCount(clusters, 'timeout', 1);
  addClusterCount(clusters, 'schema_shape', Number(run.parseStats.schemaFailures) || 0);
  addClusterCount(clusters, 'json_parse', Number(run.parseStats.jsonParseFailures) || 0);
  addClusterCount(clusters, 'placeholder', Number(run.parseStats.placeholderFailures) || 0);
  addClusterCount(clusters, 'other', Number(run.parseStats.otherFailures) || 0);
  if (!run.ok && clusters.size === 0) addClusterCount(clusters, 'other', 1);
  return sortFailureClusters(clusters);
}

function emptyDeterministicFallback(mode: 'off' | 'on-fail' | 'always' = 'on-fail'): DeterministicFallbackStats {
  const emptyScenario = () => ({
    activations: 0,
    recoveries: 0,
    targetedActivations: 0,
    targetedRecoveries: 0,
    canonicalActivations: 0,
    canonicalRecoveries: 0,
    rawPasses: 0,
    rawFailures: 0,
    recoveredByFallback: 0
  });
  return {
    mode,
    tsTodo: emptyScenario(),
    tsCsv: emptyScenario(),
    nodeApi: emptyScenario(),
    totalActivations: 0,
    totalRecoveries: 0,
    totalTargetedActivations: 0,
    totalTargetedRecoveries: 0,
    totalCanonicalActivations: 0,
    totalCanonicalRecoveries: 0,
    totalRawPasses: 0,
    totalRawFailures: 0,
    totalRecoveredByFallback: 0,
    fallbackDependencyRate: 0
  };
}

function parseArgs(argv: string[]): BatchOptions {
  const opts: BatchOptions = {
    scenarios: [...DEFAULT_BATCH_SCENARIOS],
    runs: 3,
    model: process.env.BOT_EVAL_MODEL || 'qwen2.5-coder:14b',
    plannerModel: process.env.BOT_EVAL_PLANNER_MODEL || 'deepseek-r1:8b',
    reviewerModel: process.env.BOT_EVAL_REVIEWER_MODEL || 'qwen2.5:3b',
    jsonRepairModel: process.env.BOT_EVAL_JSON_REPAIR_MODEL || 'qwen2.5:7b',
    deterministicFallbackMode: normalizeDeterministicFallbackMode(process.env.BOT_EVAL_DETERMINISTIC_FALLBACK),
    timeoutSec: Number(process.env.BOT_EVAL_TIMEOUT_SEC || 1200),
    maxIterations: Number(process.env.BOT_EVAL_MAX_ITERATIONS || 6),
    stopOnInfraFailure: parseBooleanFlag(process.env.BOT_EVAL_BATCH_STOP_ON_INFRA_FAILURE, true),
    autoRestartOnInfraFailure: parseBooleanFlag(process.env.BOT_EVAL_AUTO_RESTART_ON_INFRA_FAILURE, false),
    maxInfraRestarts: Number(process.env.BOT_EVAL_MAX_INFRA_RESTARTS || 2),
    infraRestartTimeoutSec: Number(process.env.BOT_EVAL_INFRA_RESTART_TIMEOUT_SEC || 30),
    infraRestartCooldownSec: Number(process.env.BOT_EVAL_INFRA_RESTART_COOLDOWN_SEC || 5),
    infraRestartCommand: (process.env.BOT_EVAL_INFRA_RESTART_COMMAND || '').trim() || undefined,
    ollamaBaseUrl: String(process.env.BOT_EVAL_BASE_URL || 'http://localhost:11434'),
    infraRecoveryTimeoutSec: Number(process.env.BOT_EVAL_INFRA_RECOVERY_TIMEOUT_SEC || 90),
    infraRecoveryPollSec: Number(process.env.BOT_EVAL_INFRA_RECOVERY_POLL_SEC || 5),
  };

  let scenarioOverrideUsed = false;
  const parseScenarioCsv = (raw: string): string[] => raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const ensureScenarioOverride = () => {
    if (!scenarioOverrideUsed) {
      opts.scenarios = [];
      scenarioOverrideUsed = true;
    }
  };
  const addScenario = (s: string) => {
    if (!s) return;
    ensureScenarioOverride();
    if (!opts.scenarios.includes(s)) opts.scenarios.push(s);
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[i + 1];
    if (a === '--scenarios' && next()) {
      ensureScenarioOverride();
      for (const scenario of parseScenarioCsv(next())) addScenario(scenario);
      i++;
      continue;
    }
    if (a === '--scenario' && next()) {
      addScenario(next());
      i++;
      continue;
    }
    if (a === '--runs' && next()) {
      opts.runs = Number(next());
      i++;
      continue;
    }
    if (a === '--model' && next()) {
      opts.model = next();
      i++;
      continue;
    }
    if (a === '--plannerModel' && next()) {
      opts.plannerModel = next();
      i++;
      continue;
    }
    if (a === '--reviewerModel' && next()) {
      opts.reviewerModel = next();
      i++;
      continue;
    }
    if (a === '--jsonRepairModel' && next()) {
      opts.jsonRepairModel = next();
      i++;
      continue;
    }
    if (a === '--deterministicFallback' && next()) {
      opts.deterministicFallbackMode = normalizeDeterministicFallbackMode(next());
      i++;
      continue;
    }
    if (a === '--timeoutSec' && next()) {
      opts.timeoutSec = Number(next());
      i++;
      continue;
    }
    if (a === '--maxIterations' && next()) {
      opts.maxIterations = Number(next());
      i++;
      continue;
    }
    if (a === '--hardTimeoutSec' && next()) {
      opts.hardTimeoutSec = Number(next());
      i++;
      continue;
    }
    if (a === '--stopOnInfraFailure' && next()) {
      opts.stopOnInfraFailure = parseBooleanFlag(next(), true);
      i++;
      continue;
    }
    if (a === '--continueOnInfraFailure') {
      opts.stopOnInfraFailure = false;
      continue;
    }
    if (a === '--autoRestartOnInfraFailure' && next()) {
      opts.autoRestartOnInfraFailure = parseBooleanFlag(next(), false);
      i++;
      continue;
    }
    if (a === '--maxInfraRestarts' && next()) {
      opts.maxInfraRestarts = Number(next());
      i++;
      continue;
    }
    if (a === '--infraRestartTimeoutSec' && next()) {
      opts.infraRestartTimeoutSec = Number(next());
      i++;
      continue;
    }
    if (a === '--infraRestartCooldownSec' && next()) {
      opts.infraRestartCooldownSec = Number(next());
      i++;
      continue;
    }
    if (a === '--infraRestartCommand' && next()) {
      opts.infraRestartCommand = String(next() || '').trim() || undefined;
      i++;
      continue;
    }
    if (a === '--ollamaBaseUrl' && next()) {
      opts.ollamaBaseUrl = String(next() || opts.ollamaBaseUrl);
      i++;
      continue;
    }
    if (a === '--infraRecoveryTimeoutSec' && next()) {
      opts.infraRecoveryTimeoutSec = Number(next());
      i++;
      continue;
    }
    if (a === '--infraRecoveryPollSec' && next()) {
      opts.infraRecoveryPollSec = Number(next());
      i++;
      continue;
    }
    if (a === '--outDir' && next()) {
      opts.outDir = next();
      i++;
      continue;
    }
    if (a === '--help' || a === '-h') {
      printUsageAndExit(0);
    }
  }

  if (!Number.isFinite(opts.runs) || opts.runs <= 0) opts.runs = 1;
  if (!Number.isFinite(opts.timeoutSec) || opts.timeoutSec <= 0) opts.timeoutSec = 1200;
  if (!Number.isFinite(opts.maxIterations) || opts.maxIterations <= 0) opts.maxIterations = 3;
  if (!Number.isFinite(opts.maxInfraRestarts) || opts.maxInfraRestarts < 0) opts.maxInfraRestarts = 2;
  if (!Number.isFinite(opts.infraRestartTimeoutSec) || opts.infraRestartTimeoutSec <= 0) {
    opts.infraRestartTimeoutSec = 30;
  }
  if (!Number.isFinite(opts.infraRestartCooldownSec) || opts.infraRestartCooldownSec < 0) {
    opts.infraRestartCooldownSec = 5;
  }
  if (!Number.isFinite(opts.infraRecoveryTimeoutSec) || opts.infraRecoveryTimeoutSec <= 0) {
    opts.infraRecoveryTimeoutSec = 90;
  }
  if (!Number.isFinite(opts.infraRecoveryPollSec) || opts.infraRecoveryPollSec <= 0) {
    opts.infraRecoveryPollSec = 5;
  }
  if (opts.hardTimeoutSec != null && (!Number.isFinite(opts.hardTimeoutSec) || opts.hardTimeoutSec <= 0)) {
    opts.hardTimeoutSec = undefined;
  }
  if (opts.scenarios.length === 0) opts.scenarios = [...DEFAULT_BATCH_SCENARIOS];
  opts.deterministicFallbackMode = normalizeDeterministicFallbackMode(opts.deterministicFallbackMode);
  return opts;
}

export function parseBatchArgs(argv: string[]): BatchOptions {
  return parseArgs(argv);
}

function parseBooleanFlag(raw: unknown, fallback: boolean): boolean {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return fallback;
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return fallback;
}

function printUsageAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.log([
    'Usage: npm run bot:eval:batch -- [options]',
    '',
    'Options:',
    '  --scenarios <csv>          Scenario ids (default: ts-todo-oracle,node-api-oracle,ts-csv-oracle,python-ai-stdlib-oracle,node-project-api-large)',
    '  --scenario <id>            Scenario id (repeatable, replaces defaults)',
    '  --runs <n>                 Runs per scenario (default: 3)',
    '  --model <name>             Model (default: qwen2.5-coder:14b)',
    '  --plannerModel <name>      Planner model (default: deepseek-r1:8b)',
    '  --reviewerModel <name>     Reviewer model (default: qwen2.5:3b)',
    '  --jsonRepairModel <name>   JSON repair model (default: qwen2.5:7b)',
    '  --deterministicFallback <mode>  Deterministic fallback policy: off|on-fail|always (default: on-fail)',
    '  --timeoutSec <n>           Request timeout seconds (default: 1200)',
    '  --maxIterations <n>        Iterations (default: 6)',
    '  --hardTimeoutSec <n>       Hard timeout per run (optional)',
    '  --stopOnInfraFailure <bool>  Stop remaining runs after detected Ollama infra outage (default: true)',
    '  --continueOnInfraFailure   Continue batch even after infra outage detection',
    '  --autoRestartOnInfraFailure <bool>  Auto-restart Ollama when recovery probe times out (default: false)',
    '  --maxInfraRestarts <n>     Max automatic Ollama restarts per batch (default: 2)',
    '  --infraRestartTimeoutSec <n>  Timeout for one restart command execution (default: 30)',
    '  --infraRestartCooldownSec <n> Cooldown after restart before probing readiness (default: 5)',
    '  --infraRestartCommand <cmd> Custom restart command (optional)',
    '  --ollamaBaseUrl <url>      Ollama base URL for infra recovery probes (default: http://localhost:11434)',
    '  --infraRecoveryTimeoutSec <n>  Wait timeout before next run after infra outage when continuing (default: 90)',
    '  --infraRecoveryPollSec <n> Probe interval during infra recovery wait (default: 5)',
    '  --outDir <path>            Batch output directory (default: projects/bot_eval_run/batch_<ts>)',
  ].join('\n'));
  process.exit(code);
}

const OLLAMA_UNREACHABLE_PATTERNS: RegExp[] = [
  /cannot reach ollama/i,
  /start ollama server/i,
  /\/api\/tags failed/i,
  /ollama request failed:\s*request to .*\/api\/generate failed/i,
  /ecconnrefused/i,
  /connect econnrefused/i
];

const OLLAMA_MODEL_MISSING_PATTERNS: RegExp[] = [
  /requested model "([^"]+)" is not available/i,
  /pull model "([^"]+)"/i,
  /pull it first: "ollama pull ([^"]+)"/i
];

function detectPatternMatch(text: string, patterns: RegExp[]): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }
  return null;
}

export function detectOllamaInfraFailureFromText(
  text: string,
  source: 'validation' | 'run_log' = 'validation'
): InfraFailureSignal | null {
  const haystack = String(text || '');
  if (!haystack.trim()) return null;

  const unreachableMatch = detectPatternMatch(haystack, OLLAMA_UNREACHABLE_PATTERNS);
  if (unreachableMatch) {
    return {
      kind: 'ollama_unreachable',
      message: 'Cannot reach Ollama preflight endpoint (/api/tags).',
      source
    };
  }

  const modelMissingMatch = detectPatternMatch(haystack, OLLAMA_MODEL_MISSING_PATTERNS);
  if (modelMissingMatch) {
    const model = String(modelMissingMatch[1] || '').trim();
    return {
      kind: 'ollama_model_missing',
      message: model
        ? `Requested Ollama model "${model}" is missing; run "ollama pull ${model}".`
        : 'Requested Ollama model is missing; run "ollama pull <model>".',
      source
    };
  }

  return null;
}

export function shouldAbortBatchOnInfraFailure(
  opts: Pick<BatchOptions, 'stopOnInfraFailure'>,
  run: Pick<RunResult, 'infraFailure'>
): boolean {
  return Boolean(opts.stopOnInfraFailure && run.infraFailure);
}

async function probeOllamaTags(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const url = new URL('/api/tags', baseUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal as any });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForOllamaRecovery(params: {
  baseUrl: string;
  timeoutMs: number;
  pollMs: number;
  probeTimeoutMs?: number;
  probe?: (baseUrl: string, timeoutMs: number) => Promise<boolean>;
}): Promise<InfraRecoveryResult> {
  const started = Date.now();
  const timeoutMs = Math.max(1000, Number(params.timeoutMs) || 1000);
  const pollMs = Math.max(200, Number(params.pollMs) || 1000);
  const probeTimeoutMs = Math.max(1000, Number(params.probeTimeoutMs) || Math.min(15000, pollMs * 2));
  const probeFn = params.probe || probeOllamaTags;

  let attempts = 0;
  while (Date.now() - started <= timeoutMs) {
    attempts += 1;
    if (await probeFn(params.baseUrl, probeTimeoutMs)) {
      return { recovered: true, attempts, elapsedMs: Date.now() - started };
    }
    const elapsed = Date.now() - started;
    if (elapsed >= timeoutMs) break;
    const waitMs = Math.min(pollMs, Math.max(0, timeoutMs - elapsed));
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  return { recovered: false, attempts, elapsedMs: Date.now() - started };
}

export function resolveOllamaRestartCommand(
  configuredCommand?: string,
  platform: NodeJS.Platform = process.platform
): string {
  const custom = String(configuredCommand || '').trim();
  if (custom) return custom;
  if (platform === 'win32') {
    return 'taskkill /IM ollama.exe /F >nul 2>&1 & powershell -NoProfile -Command "Start-Process -FilePath ollama -ArgumentList serve -WindowStyle Hidden"';
  }
  return 'pkill -f "ollama serve" >/dev/null 2>&1 || true; nohup ollama serve >/dev/null 2>&1 &';
}

export async function executeShellCommand(params: {
  command: string;
  timeoutMs: number;
}): Promise<InfraRestartResult> {
  const command = String(params.command || '').trim();
  const timeoutMs = Math.max(1000, Number(params.timeoutMs) || 1000);
  const started = Date.now();
  if (!command) {
    return {
      ok: false,
      elapsedMs: 0,
      error: 'Empty restart command.',
      command
    };
  }

  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
  const shellArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', command]
    : ['-lc', command];

  return await new Promise<InfraRestartResult>((resolve) => {
    const child = spawn(shell, shellArgs, { stdio: 'ignore', windowsHide: true });
    let done = false;
    const finish = (result: InfraRestartResult) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore kill errors for already-exited processes.
      }
      finish({
        ok: false,
        elapsedMs: Date.now() - started,
        error: `Restart command timed out after ${timeoutMs}ms.`,
        command
      });
    }, timeoutMs);

    child.on('error', (err: any) => {
      clearTimeout(timer);
      finish({
        ok: false,
        elapsedMs: Date.now() - started,
        error: String(err?.message || err),
        command
      });
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      finish({
        ok: code === 0 || code === null,
        elapsedMs: Date.now() - started,
        error: (code === 0 || code === null) ? undefined : `Restart command exited with code ${code}.`,
        command
      });
    });
  });
}

export function shouldAttemptOllamaAutoRestart(params: {
  stopOnInfraFailure: boolean;
  autoRestartOnInfraFailure: boolean;
  maxInfraRestarts: number;
  restartsUsed: number;
  infraFailure: InfraFailureSignal | null;
  recoveryRecovered: boolean;
}): boolean {
  if (params.stopOnInfraFailure) return false;
  if (!params.autoRestartOnInfraFailure) return false;
  if (!params.infraFailure || params.infraFailure.kind !== 'ollama_unreachable') return false;
  if (params.recoveryRecovered) return false;
  return params.restartsUsed < Math.max(0, Math.floor(params.maxInfraRestarts));
}

async function runSingle(params: RunSingleParams): Promise<RunResult> {
  const started = Date.now();
  const logPath = path.join(params.outDir, 'batch_run.log');
  await fs.promises.mkdir(params.outDir, { recursive: true });
  const logStream = fs.createWriteStream(logPath, { encoding: 'utf8' });

  const args: string[] = [params.tsNodePath, path.join(params.repoRoot, 'scripts', 'botEval.ts')];
  args.push('--scenario', params.scenario);
  args.push('--model', params.opts.model);
  args.push('--baseUrl', params.opts.ollamaBaseUrl);
  if (params.opts.plannerModel) args.push('--plannerModel', params.opts.plannerModel);
  if (params.opts.reviewerModel) args.push('--reviewerModel', params.opts.reviewerModel);
  if (params.opts.jsonRepairModel) args.push('--jsonRepairModel', params.opts.jsonRepairModel);
  args.push('--deterministicFallback', params.opts.deterministicFallbackMode);
  if (params.opts.timeoutSec) args.push('--timeoutSec', String(params.opts.timeoutSec));
  if (params.opts.maxIterations) args.push('--maxIterations', String(params.opts.maxIterations));
  args.push('--outDir', params.outDir);

  const child = spawn(process.execPath, args, { cwd: params.repoRoot, env: process.env });
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  if (child.stdout) child.stdout.pipe(logStream, { end: false });
  if (child.stderr) child.stderr.pipe(logStream, { end: false });

  let timedOut = false;
  let timeout: NodeJS.Timeout | undefined;
  if (params.opts.hardTimeoutSec && params.opts.hardTimeoutSec > 0) {
    timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, params.opts.hardTimeoutSec * 1000);
  }

  const exitCode: number | null = await new Promise(resolve => {
    child.on('close', code => resolve(typeof code === 'number' ? code : null));
  });
  if (timeout) clearTimeout(timeout);
  logStream.end();

  const durationMs = Date.now() - started;
  let ok = false;
  let diagnostics: string[] = [];
  let parseStats = {
    plannerFailures: 0,
    schemaFailures: 0,
    jsonRepairFailures: 0,
    parseFailures: 0,
    jsonParseFailures: 0,
    placeholderFailures: 0,
    otherFailures: 0
  };
  let deterministicFallback: DeterministicFallbackStats = emptyDeterministicFallback(params.opts.deterministicFallbackMode);
  let infraFailure: InfraFailureSignal | null = null;
  try {
    const validationPath = path.join(params.outDir, 'validation.json');
    const validation = JSON.parse(await fs.promises.readFile(validationPath, 'utf8'));
    ok = Boolean(validation?.ok);
    diagnostics = Array.isArray(validation?.diagnostics) ? validation.diagnostics : [];
    if (validation?.parseStats && typeof validation.parseStats === 'object') {
      parseStats = {
        plannerFailures: Number(validation.parseStats.plannerFailures) || 0,
        schemaFailures: Number(validation.parseStats.schemaFailures) || 0,
        jsonRepairFailures: Number(validation.parseStats.jsonRepairFailures) || 0,
        parseFailures: Number(validation.parseStats.parseFailures) || 0,
        jsonParseFailures: Number(validation.parseStats.jsonParseFailures) || 0,
        placeholderFailures: Number(validation.parseStats.placeholderFailures) || 0,
        otherFailures: Number(validation.parseStats.otherFailures) || 0,
      };
    }
    if (validation?.deterministicFallback && typeof validation.deterministicFallback === 'object') {
      const src = validation.deterministicFallback;
      deterministicFallback = {
        mode: normalizeDeterministicFallbackMode(src.mode),
        tsTodo: {
          activations: Number(src?.tsTodo?.activations) || 0,
          recoveries: Number(src?.tsTodo?.recoveries) || 0,
          targetedActivations: Number(src?.tsTodo?.targetedActivations) || 0,
          targetedRecoveries: Number(src?.tsTodo?.targetedRecoveries) || 0,
          canonicalActivations: Number(src?.tsTodo?.canonicalActivations) || 0,
          canonicalRecoveries: Number(src?.tsTodo?.canonicalRecoveries) || 0,
          rawPasses: Number(src?.tsTodo?.rawPasses) || 0,
          rawFailures: Number(src?.tsTodo?.rawFailures) || 0,
          recoveredByFallback: Number(src?.tsTodo?.recoveredByFallback) || 0
        },
        tsCsv: {
          activations: Number(src?.tsCsv?.activations) || 0,
          recoveries: Number(src?.tsCsv?.recoveries) || 0,
          targetedActivations: Number(src?.tsCsv?.targetedActivations) || 0,
          targetedRecoveries: Number(src?.tsCsv?.targetedRecoveries) || 0,
          canonicalActivations: Number(src?.tsCsv?.canonicalActivations) || 0,
          canonicalRecoveries: Number(src?.tsCsv?.canonicalRecoveries) || 0,
          rawPasses: Number(src?.tsCsv?.rawPasses) || 0,
          rawFailures: Number(src?.tsCsv?.rawFailures) || 0,
          recoveredByFallback: Number(src?.tsCsv?.recoveredByFallback) || 0
        },
        nodeApi: {
          activations: Number(src?.nodeApi?.activations) || 0,
          recoveries: Number(src?.nodeApi?.recoveries) || 0,
          targetedActivations: Number(src?.nodeApi?.targetedActivations) || 0,
          targetedRecoveries: Number(src?.nodeApi?.targetedRecoveries) || 0,
          canonicalActivations: Number(src?.nodeApi?.canonicalActivations) || 0,
          canonicalRecoveries: Number(src?.nodeApi?.canonicalRecoveries) || 0,
          rawPasses: Number(src?.nodeApi?.rawPasses) || 0,
          rawFailures: Number(src?.nodeApi?.rawFailures) || 0,
          recoveredByFallback: Number(src?.nodeApi?.recoveredByFallback) || 0
        },
        totalActivations: Number(src.totalActivations) || 0,
        totalRecoveries: Number(src.totalRecoveries) || 0,
        totalTargetedActivations: Number(src.totalTargetedActivations) || 0,
        totalTargetedRecoveries: Number(src.totalTargetedRecoveries) || 0,
        totalCanonicalActivations: Number(src.totalCanonicalActivations) || 0,
        totalCanonicalRecoveries: Number(src.totalCanonicalRecoveries) || 0,
        totalRawPasses: Number(src.totalRawPasses) || 0,
        totalRawFailures: Number(src.totalRawFailures) || 0,
        totalRecoveredByFallback: Number(src.totalRecoveredByFallback) || 0,
        fallbackDependencyRate: Number(src.fallbackDependencyRate) || 0
      };
    }
  } catch (e: any) {
    diagnostics = [`Failed to read validation.json: ${String(e?.message || e)}`];
  }

  if (!ok) {
    const diagnosticText = (diagnostics || []).join('\n');
    infraFailure = detectOllamaInfraFailureFromText(diagnosticText, 'validation');
    if (!infraFailure) {
      try {
        const logText = await fs.promises.readFile(logPath, 'utf8');
        infraFailure = detectOllamaInfraFailureFromText(logText, 'run_log');
      } catch {
        // Ignore missing log reads, validation diagnostics are primary signal.
      }
    }
    if (infraFailure) {
      const marker = `[infra:${infraFailure.kind}] ${infraFailure.message}`;
      if (!(diagnostics || []).some(d => String(d || '').includes(marker))) {
        diagnostics = [marker, ...(diagnostics || [])];
      }
    }
  }

  if (timedOut) {
    const timeoutMessage = `Run exceeded hard timeout (${params.opts.hardTimeoutSec || 0}s) and was terminated.`;
    if (!(diagnostics || []).some(d => String(d || '').includes(timeoutMessage))) {
      diagnostics = [timeoutMessage, ...(diagnostics || [])];
    }
  }

  return {
    scenario: params.scenario,
    runIndex: params.runIndex,
    ok,
    exitCode,
    durationMs,
    outDir: params.outDir,
    diagnostics,
    timedOut,
    parseStats,
    deterministicFallback,
    infraFailure,
  };
}

export function summarize(results: RunResult[]): SummaryRow[] {
  const byScenario = new Map<string, RunResult[]>();
  for (const r of results) {
    const arr = byScenario.get(r.scenario) || [];
    arr.push(r);
    byScenario.set(r.scenario, arr);
  }
  const summary: SummaryRow[] = [];
  for (const [scenario, runs] of byScenario.entries()) {
    const pass = runs.filter(r => r.ok).length;
    const total = runs.length;
    const avgMs = Math.round(runs.reduce((a, b) => a + b.durationMs, 0) / total);
    const runsWithPlannerError = runs.filter(r => (Number(r.parseStats.plannerFailures) || 0) > 0).length;
    const runsWithJsonRepairError = runs.filter(r => (Number(r.parseStats.jsonRepairFailures) || 0) > 0).length;
    const jsonRepairErrorFiles = runs.reduce((acc, r) => acc + (Number(r.parseStats.jsonRepairFailures) || 0), 0);
    const runsWithSchemaFailure = runs.filter(r => (Number(r.parseStats.schemaFailures) || 0) > 0).length;
    const schemaFailures = runs.reduce((acc, r) => acc + (Number(r.parseStats.schemaFailures) || 0), 0);
    const runsWithJsonParseFailure = runs.filter(r => (Number(r.parseStats.jsonParseFailures) || 0) > 0).length;
    const jsonParseFailures = runs.reduce((acc, r) => acc + (Number(r.parseStats.jsonParseFailures) || 0), 0);
    const runsWithPlaceholderFailure = runs.filter(r => (Number(r.parseStats.placeholderFailures) || 0) > 0).length;
    const placeholderFailures = runs.reduce((acc, r) => acc + (Number(r.parseStats.placeholderFailures) || 0), 0);
    const runsWithOtherParseFailure = runs.filter(r => (Number(r.parseStats.otherFailures) || 0) > 0).length;
    const otherParseFailures = runs.reduce((acc, r) => acc + (Number(r.parseStats.otherFailures) || 0), 0);
    const runsWithDeterministicFallback = runs.filter(r => r.deterministicFallback.totalActivations > 0).length;
    const deterministicFallbackActivations = runs.reduce((acc, r) => acc + r.deterministicFallback.totalActivations, 0);
    const deterministicFallbackRecoveries = runs.reduce((acc, r) => acc + r.deterministicFallback.totalRecoveries, 0);
    const deterministicFallbackTargetedActivations = runs.reduce((acc, r) => acc + r.deterministicFallback.totalTargetedActivations, 0);
    const deterministicFallbackTargetedRecoveries = runs.reduce((acc, r) => acc + r.deterministicFallback.totalTargetedRecoveries, 0);
    const deterministicFallbackCanonicalActivations = runs.reduce((acc, r) => acc + r.deterministicFallback.totalCanonicalActivations, 0);
    const deterministicFallbackCanonicalRecoveries = runs.reduce((acc, r) => acc + r.deterministicFallback.totalCanonicalRecoveries, 0);
    const rawOutcome = runs.map(deriveRawOutcomeForRun);
    const rawPasses = rawOutcome.reduce((acc, r) => acc + r.rawPasses, 0);
    const rawFailures = rawOutcome.reduce((acc, r) => acc + r.rawFailures, 0);
    const recoveredByFallback = rawOutcome.reduce((acc, r) => acc + r.recoveredByFallback, 0);
    const rawTotal = rawPasses + rawFailures;
    const rawPassRate = rawTotal > 0 ? rawPasses / rawTotal : null;
    const fallbackDependencyRate = rawTotal > 0 ? recoveredByFallback / rawTotal : 0;
    const runsWithRawPass = rawOutcome.filter(r => r.rawPasses > 0).length;
    const runsRecoveredByFallback = rawOutcome.filter(r => r.recoveredByFallback > 0).length;
    const rawRunPassRate = total > 0 ? runsWithRawPass / total : 0;
    const fallbackDependencyRunRate = total > 0 ? runsRecoveredByFallback / total : 0;
    const clusterMap = new Map<string, number>();
    for (const run of runs) {
      if (run.ok) continue;
      const clusters = collectFailureClustersForRun(run);
      for (const cluster of clusters) addClusterCount(clusterMap, cluster.id, cluster.count);
    }
    const topFailureClusters = sortFailureClusters(clusterMap).slice(0, 5);
    summary.push({
      scenario,
      pass,
      total,
      passRate: pass / total,
      avgMs,
      runsWithPlannerError,
      runsWithJsonRepairError,
      jsonRepairErrorFiles,
      runsWithSchemaFailure,
      schemaFailures,
      runsWithJsonParseFailure,
      jsonParseFailures,
      runsWithPlaceholderFailure,
      placeholderFailures,
      runsWithOtherParseFailure,
      otherParseFailures,
      runsWithDeterministicFallback,
      deterministicFallbackActivations,
      deterministicFallbackRecoveries,
      deterministicFallbackTargetedActivations,
      deterministicFallbackTargetedRecoveries,
      deterministicFallbackCanonicalActivations,
      deterministicFallbackCanonicalRecoveries,
      rawPasses,
      rawFailures,
      rawPassRate,
      recoveredByFallback,
      fallbackDependencyRate,
      runsWithRawPass,
      runsRecoveredByFallback,
      rawRunPassRate,
      fallbackDependencyRunRate,
      topFailureClusters
    });
  }
  return summary;
}

export async function persistBatchArtifacts(params: {
  batchOutDir: string;
  meta: Record<string, unknown>;
  results: RunResult[];
  summary: SummaryRow[];
  infraRecoveryEvents: Array<{
    scenario: string;
    runIndex: number;
    outDir: string;
    kind: InfraFailureKind;
    recovered: boolean;
    attempts: number;
    elapsedMs: number;
    occurredAt: string;
  }>;
  infraRestartEvents: Array<{
    scenario: string;
    runIndex: number;
    outDir: string;
    kind: InfraFailureKind;
    restartIndex: number;
    command: string;
    restartOk: boolean;
    restartElapsedMs: number;
    restartError?: string;
    recoveredAfterRestart: boolean;
    recoveryAttempts: number;
    recoveryElapsedMs: number;
    occurredAt: string;
  }>;
  infraAbort: BatchInfraAbortRecord | null;
  totalPlannedRuns: number;
  batchError?: BatchErrorRecord | null;
}): Promise<void> {
  await fs.promises.mkdir(params.batchOutDir, { recursive: true });
  await fs.promises.writeFile(path.join(params.batchOutDir, 'meta.json'), JSON.stringify(params.meta, null, 2), 'utf8');
  await fs.promises.writeFile(path.join(params.batchOutDir, 'results.json'), JSON.stringify(params.results, null, 2), 'utf8');
  await fs.promises.writeFile(path.join(params.batchOutDir, 'summary.json'), JSON.stringify(params.summary, null, 2), 'utf8');
  if (params.infraRecoveryEvents.length > 0) {
    await fs.promises.writeFile(
      path.join(params.batchOutDir, 'infra_recovery.json'),
      JSON.stringify(params.infraRecoveryEvents, null, 2),
      'utf8'
    );
  }
  if (params.infraRestartEvents.length > 0) {
    await fs.promises.writeFile(
      path.join(params.batchOutDir, 'infra_restart.json'),
      JSON.stringify(params.infraRestartEvents, null, 2),
      'utf8'
    );
  }
  if (params.infraAbort) {
    const skippedRuns = Math.max(0, params.totalPlannedRuns - params.results.length);
    await fs.promises.writeFile(
      path.join(params.batchOutDir, 'infra_abort.json'),
      JSON.stringify({
        ...params.infraAbort,
        plannedRuns: params.totalPlannedRuns,
        executedRuns: params.results.length,
        skippedRuns
      }, null, 2),
      'utf8'
    );
  }
  if (params.batchError) {
    await fs.promises.writeFile(
      path.join(params.batchOutDir, 'batch_error.json'),
      JSON.stringify(params.batchError, null, 2),
      'utf8'
    );
  }
}

export async function runBatch(opts: BatchOptions, deps: BatchRuntimeDeps = {}): Promise<{
  batchOutDir: string;
  results: RunResult[];
  summary: SummaryRow[];
  infraAbort: BatchInfraAbortRecord | null;
  batchError: BatchErrorRecord | null;
}> {
  const repoRoot = deps.repoRoot || path.resolve(__dirname, '..');
  const runSingleImpl = deps.runSingle || runSingle;
  const tsNodePath = path.join(repoRoot, 'node_modules', 'ts-node', 'dist', 'bin.js');
  if (!fs.existsSync(tsNodePath)) {
    throw new Error(`ts-node not found at ${tsNodePath}`);
  }

  const batchId = Date.now();
  const batchOutDir = path.resolve(opts.outDir || path.join(repoRoot, 'projects', 'bot_eval_run', `batch_${batchId}`));
  await fs.promises.mkdir(batchOutDir, { recursive: true });

  const meta = {
    batchId,
    startedAt: new Date().toISOString(),
    scenarios: opts.scenarios,
    runs: opts.runs,
    model: opts.model,
    plannerModel: opts.plannerModel ?? null,
    reviewerModel: opts.reviewerModel ?? null,
    jsonRepairModel: opts.jsonRepairModel ?? null,
    deterministicFallbackMode: opts.deterministicFallbackMode,
    timeoutSec: opts.timeoutSec,
    maxIterations: opts.maxIterations,
    hardTimeoutSec: opts.hardTimeoutSec ?? null,
    stopOnInfraFailure: opts.stopOnInfraFailure,
    autoRestartOnInfraFailure: opts.autoRestartOnInfraFailure,
    maxInfraRestarts: opts.maxInfraRestarts,
    infraRestartTimeoutSec: opts.infraRestartTimeoutSec,
    infraRestartCooldownSec: opts.infraRestartCooldownSec,
    infraRestartCommand: opts.infraRestartCommand ?? null,
    ollamaBaseUrl: opts.ollamaBaseUrl,
    infraRecoveryTimeoutSec: opts.infraRecoveryTimeoutSec,
    infraRecoveryPollSec: opts.infraRecoveryPollSec,
    outDir: batchOutDir,
  };
  await fs.promises.writeFile(path.join(batchOutDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  const results: RunResult[] = [];
  const infraRecoveryEvents: Array<{
    scenario: string;
    runIndex: number;
    outDir: string;
    kind: InfraFailureKind;
    recovered: boolean;
    attempts: number;
    elapsedMs: number;
    occurredAt: string;
  }> = [];
  const infraRestartEvents: Array<{
    scenario: string;
    runIndex: number;
    outDir: string;
    kind: InfraFailureKind;
    restartIndex: number;
    command: string;
    restartOk: boolean;
    restartElapsedMs: number;
    restartError?: string;
    recoveredAfterRestart: boolean;
    recoveryAttempts: number;
    recoveryElapsedMs: number;
    occurredAt: string;
  }> = [];
  let infraRestartCount = 0;
  const totalPlannedRuns = opts.scenarios.length * opts.runs;
  let infraAbort: BatchInfraAbortRecord | null = null;
  let batchError: BatchErrorRecord | null = null;
  let thrownError: unknown;

  try {
    for (const scenario of opts.scenarios) {
      for (let i = 1; i <= opts.runs; i++) {
        const runOutDir = path.join(batchOutDir, `${scenario}_run_${String(i).padStart(2, '0')}`);
        // eslint-disable-next-line no-console
        console.log(`Running ${scenario} (${i}/${opts.runs})...`);
        const res = await runSingleImpl({ repoRoot, tsNodePath, opts, scenario, runIndex: i, outDir: runOutDir });
        results.push(res);
        // eslint-disable-next-line no-console
        console.log(
          `  -> ${res.ok ? 'OK' : 'FAIL'} (${Math.round(res.durationMs / 1000)}s) ${res.outDir}`
        );
        if (shouldAbortBatchOnInfraFailure(opts, res) && res.infraFailure) {
          infraAbort = {
            scenario,
            runIndex: i,
            outDir: res.outDir,
            kind: res.infraFailure.kind,
            message: res.infraFailure.message,
            source: res.infraFailure.source,
            detectedAt: new Date().toISOString()
          };
          // eslint-disable-next-line no-console
          console.warn(
            `  -> INFRA ABORT: ${res.infraFailure.kind} (${res.infraFailure.source}) ${res.infraFailure.message}`
          );
          break;
        }
        if (!opts.stopOnInfraFailure && res.infraFailure?.kind === 'ollama_unreachable') {
          // In continue mode, wait for Ollama health recovery to avoid immediate repeated preflight failures.
          // eslint-disable-next-line no-console
          console.warn(
            `  -> INFRA RECOVERY WAIT: probing ${opts.ollamaBaseUrl}/api/tags up to ${opts.infraRecoveryTimeoutSec}s`
          );
          let recovery = await waitForOllamaRecovery({
            baseUrl: opts.ollamaBaseUrl,
            timeoutMs: opts.infraRecoveryTimeoutSec * 1000,
            pollMs: opts.infraRecoveryPollSec * 1000
          });
          infraRecoveryEvents.push({
            scenario,
            runIndex: i,
            outDir: res.outDir,
            kind: res.infraFailure.kind,
            recovered: recovery.recovered,
            attempts: recovery.attempts,
            elapsedMs: recovery.elapsedMs,
            occurredAt: new Date().toISOString()
          });
          // eslint-disable-next-line no-console
          console.warn(
            `  -> INFRA RECOVERY ${recovery.recovered ? 'OK' : 'TIMEOUT'} attempts=${recovery.attempts} wait=${Math.round(recovery.elapsedMs / 1000)}s`
          );

          if (shouldAttemptOllamaAutoRestart({
            stopOnInfraFailure: opts.stopOnInfraFailure,
            autoRestartOnInfraFailure: opts.autoRestartOnInfraFailure,
            maxInfraRestarts: opts.maxInfraRestarts,
            restartsUsed: infraRestartCount,
            infraFailure: res.infraFailure,
            recoveryRecovered: recovery.recovered
          })) {
            const restartCommand = resolveOllamaRestartCommand(opts.infraRestartCommand);
            infraRestartCount += 1;
            // eslint-disable-next-line no-console
            console.warn(
              `  -> INFRA RESTART ${infraRestartCount}/${opts.maxInfraRestarts}: ${restartCommand}`
            );
            const restartResult = await executeShellCommand({
              command: restartCommand,
              timeoutMs: opts.infraRestartTimeoutSec * 1000
            });
            if (opts.infraRestartCooldownSec > 0) {
              await new Promise(resolve => setTimeout(resolve, opts.infraRestartCooldownSec * 1000));
            }
            recovery = await waitForOllamaRecovery({
              baseUrl: opts.ollamaBaseUrl,
              timeoutMs: opts.infraRecoveryTimeoutSec * 1000,
              pollMs: opts.infraRecoveryPollSec * 1000
            });
            infraRestartEvents.push({
              scenario,
              runIndex: i,
              outDir: res.outDir,
              kind: res.infraFailure.kind,
              restartIndex: infraRestartCount,
              command: restartResult.command,
              restartOk: restartResult.ok,
              restartElapsedMs: restartResult.elapsedMs,
              restartError: restartResult.error,
              recoveredAfterRestart: recovery.recovered,
              recoveryAttempts: recovery.attempts,
              recoveryElapsedMs: recovery.elapsedMs,
              occurredAt: new Date().toISOString()
            });
            // eslint-disable-next-line no-console
            console.warn(
              `  -> INFRA RESTART RESULT ${restartResult.ok ? 'OK' : 'FAIL'} ` +
              `restartWait=${Math.round(restartResult.elapsedMs / 1000)}s ` +
              `postRecovery=${recovery.recovered ? 'OK' : 'TIMEOUT'}`
            );
          }
        }
      }
      if (infraAbort) {
        break;
      }
    }
  } catch (err) {
    thrownError = err;
    const asError = err instanceof Error ? err : new Error(String(err));
    batchError = {
      name: asError.name,
      message: asError.message,
      stack: asError.stack,
      occurredAt: new Date().toISOString()
    };
  }

  const summary = summarize(results);
  await persistBatchArtifacts({
    batchOutDir,
    meta,
    results,
    summary,
    infraRecoveryEvents,
    infraRestartEvents,
    infraAbort,
    totalPlannedRuns,
    batchError
  });

  // eslint-disable-next-line no-console
  console.log('\nSummary:');
  for (const s of summary) {
    const pct = Math.round(s.passRate * 100);
    const topClusters = s.topFailureClusters
      .slice(0, 3)
      .map(c => `${c.id}:${c.count}`)
      .join(',');
    // eslint-disable-next-line no-console
    console.log(
      `- ${s.scenario}: ${s.pass}/${s.total} (${pct}%) avg ${Math.round(s.avgMs / 1000)}s` +
      ` | plannerErrRuns=${s.runsWithPlannerError}` +
      ` jsonRepairErrRuns=${s.runsWithJsonRepairError}` +
      ` jsonRepairErrFiles=${s.jsonRepairErrorFiles}` +
      ` schemaFailRuns=${s.runsWithSchemaFailure}` +
      ` jsonParseRuns=${s.runsWithJsonParseFailure}` +
      ` placeholderRuns=${s.runsWithPlaceholderFailure}` +
      ` fallbackActs=${s.deterministicFallbackActivations}` +
      ` fallbackRecovers=${s.deterministicFallbackRecoveries}` +
      ` rawPassRate=${s.rawPassRate == null ? 'n/a' : `${Math.round(s.rawPassRate * 100)}%`}` +
      ` fallbackDependencyRate=${Math.round(s.fallbackDependencyRate * 100)}%` +
      ` rawRunPassRate=${Math.round(s.rawRunPassRate * 100)}%` +
      ` fallbackDependencyRunRate=${Math.round(s.fallbackDependencyRunRate * 100)}%` +
      ` topClusters=${topClusters || 'n/a'}`
    );
  }
  const overallRawOutcome = results.map(deriveRawOutcomeForRun);
  const overallRawPasses = overallRawOutcome.reduce((acc, r) => acc + r.rawPasses, 0);
  const overallRawFailures = overallRawOutcome.reduce((acc, r) => acc + r.rawFailures, 0);
  const overallRawTotal = overallRawPasses + overallRawFailures;
  const overallRecoveredByFallback = overallRawOutcome.reduce((acc, r) => acc + r.recoveredByFallback, 0);
  const overallRawPassRate = overallRawTotal > 0 ? overallRawPasses / overallRawTotal : null;
  const overallFallbackDependencyRate = overallRawTotal > 0 ? overallRecoveredByFallback / overallRawTotal : 0;
  const overallRunsWithRawPass = overallRawOutcome.filter(r => r.rawPasses > 0).length;
  const overallRunsRecoveredByFallback = overallRawOutcome.filter(r => r.recoveredByFallback > 0).length;
  const overallRawRunPassRate = results.length > 0 ? overallRunsWithRawPass / results.length : 0;
  const overallFallbackDependencyRunRate = results.length > 0 ? overallRunsRecoveredByFallback / results.length : 0;
  const overallClusterMap = new Map<string, number>();
  for (const result of results) {
    if (result.ok) continue;
    const clusters = collectFailureClustersForRun(result);
    for (const cluster of clusters) addClusterCount(overallClusterMap, cluster.id, cluster.count);
  }
  const overallTopFailureClusters = sortFailureClusters(overallClusterMap).slice(0, 8);
  const overall = {
    runsWithPlannerError: results.filter(r => (Number(r.parseStats.plannerFailures) || 0) > 0).length,
    runsWithJsonRepairError: results.filter(r => (Number(r.parseStats.jsonRepairFailures) || 0) > 0).length,
    jsonRepairErrorFiles: results.reduce((acc, r) => acc + (Number(r.parseStats.jsonRepairFailures) || 0), 0),
    runsWithSchemaFailure: results.filter(r => (Number(r.parseStats.schemaFailures) || 0) > 0).length,
    runsWithJsonParseFailure: results.filter(r => (Number(r.parseStats.jsonParseFailures) || 0) > 0).length,
    jsonParseFailures: results.reduce((acc, r) => acc + (Number(r.parseStats.jsonParseFailures) || 0), 0),
    runsWithPlaceholderFailure: results.filter(r => (Number(r.parseStats.placeholderFailures) || 0) > 0).length,
    placeholderFailures: results.reduce((acc, r) => acc + (Number(r.parseStats.placeholderFailures) || 0), 0),
    runsWithOtherParseFailure: results.filter(r => (Number(r.parseStats.otherFailures) || 0) > 0).length,
    otherParseFailures: results.reduce((acc, r) => acc + (Number(r.parseStats.otherFailures) || 0), 0),
    runsWithDeterministicFallback: results.filter(r => r.deterministicFallback.totalActivations > 0).length,
    deterministicFallbackActivations: results.reduce((acc, r) => acc + r.deterministicFallback.totalActivations, 0),
    deterministicFallbackRecoveries: results.reduce((acc, r) => acc + r.deterministicFallback.totalRecoveries, 0),
    deterministicFallbackTargetedActivations: results.reduce((acc, r) => acc + r.deterministicFallback.totalTargetedActivations, 0),
    deterministicFallbackTargetedRecoveries: results.reduce((acc, r) => acc + r.deterministicFallback.totalTargetedRecoveries, 0),
    deterministicFallbackCanonicalActivations: results.reduce((acc, r) => acc + r.deterministicFallback.totalCanonicalActivations, 0),
    deterministicFallbackCanonicalRecoveries: results.reduce((acc, r) => acc + r.deterministicFallback.totalCanonicalRecoveries, 0),
    rawPasses: overallRawPasses,
    rawFailures: overallRawFailures,
    recoveredByFallback: overallRecoveredByFallback,
    rawPassRate: overallRawPassRate,
    fallbackDependencyRate: overallFallbackDependencyRate,
    runsWithRawPass: overallRunsWithRawPass,
    runsRecoveredByFallback: overallRunsRecoveredByFallback,
    rawRunPassRate: overallRawRunPassRate,
    fallbackDependencyRunRate: overallFallbackDependencyRunRate,
    topFailureClusters: overallTopFailureClusters
  };
  // eslint-disable-next-line no-console
  console.log(
    `Overall parse/schema: plannerErrRuns=${overall.runsWithPlannerError} ` +
    `jsonRepairErrRuns=${overall.runsWithJsonRepairError} ` +
    `jsonRepairErrFiles=${overall.jsonRepairErrorFiles} ` +
    `schemaFailRuns=${overall.runsWithSchemaFailure} ` +
    `jsonParseRuns=${overall.runsWithJsonParseFailure} ` +
    `placeholderRuns=${overall.runsWithPlaceholderFailure} ` +
    `fallbackRunCount=${overall.runsWithDeterministicFallback} ` +
    `fallbackActs=${overall.deterministicFallbackActivations} ` +
    `fallbackRecovers=${overall.deterministicFallbackRecoveries} ` +
    `targetedActs=${overall.deterministicFallbackTargetedActivations} ` +
    `canonicalActs=${overall.deterministicFallbackCanonicalActivations} ` +
    `rawPassRate=${overall.rawPassRate == null ? 'n/a' : `${Math.round(overall.rawPassRate * 100)}%`} ` +
    `fallbackDependencyRate=${Math.round(overall.fallbackDependencyRate * 100)}% ` +
    `rawRunPassRate=${Math.round(overall.rawRunPassRate * 100)}% ` +
    `fallbackDependencyRunRate=${Math.round(overall.fallbackDependencyRunRate * 100)}% ` +
    `topClusters=${overall.topFailureClusters.map((c: FailureClusterCount) => `${c.id}:${c.count}`).join(',') || 'n/a'}`
  );
  if (infraAbort) {
    const skippedRuns = Math.max(0, totalPlannedRuns - results.length);
    // eslint-disable-next-line no-console
    console.log(
      `Batch stopped early due to infra outage (${infraAbort.kind}); skippedRuns=${skippedRuns}.`
    );
  }
  if (infraRecoveryEvents.length > 0) {
    const recoveredCount = infraRecoveryEvents.filter(e => e.recovered).length;
    // eslint-disable-next-line no-console
    console.log(
      `Infra recovery events: ${infraRecoveryEvents.length}, recovered=${recoveredCount}, timeout=${infraRecoveryEvents.length - recoveredCount}.`
    );
  }
  if (infraRestartEvents.length > 0) {
    const postRecoveryOk = infraRestartEvents.filter(e => e.recoveredAfterRestart).length;
    const restartOk = infraRestartEvents.filter(e => e.restartOk).length;
    // eslint-disable-next-line no-console
    console.log(
      `Infra restart events: ${infraRestartEvents.length}, restartOk=${restartOk}, postRecoveryOk=${postRecoveryOk}.`
    );
  }
  // eslint-disable-next-line no-console
  console.log(`\nBatch output: ${batchOutDir}`);

  if (thrownError) {
    throw thrownError;
  }

  return {
    batchOutDir,
    results,
    summary,
    infraAbort,
    batchError
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await runBatch(opts);
}

if (require.main === module) {
  main().catch(err => {
    // eslint-disable-next-line no-console
    console.error('botEvalBatch failed:', err);
    process.exit(1);
  });
}
