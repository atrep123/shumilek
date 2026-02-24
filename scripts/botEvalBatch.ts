import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

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
  outDir?: string;
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

const DEFAULT_BATCH_SCENARIOS = ['ts-todo-oracle', 'node-api-oracle', 'python-ai-stdlib-oracle'];

function supportsExplicitRawMetricsForScenario(scenario: string): boolean {
  const value = String(scenario || '').trim().toLowerCase();
  return value === 'ts-todo-oracle' || value === 'node-api-oracle';
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

function printUsageAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.log([
    'Usage: npm run bot:eval:batch -- [options]',
    '',
    'Options:',
    '  --scenarios <csv>          Scenario ids (default: ts-todo-oracle,node-api-oracle,python-ai-stdlib-oracle)',
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
    '  --outDir <path>            Batch output directory (default: projects/bot_eval_run/batch_<ts>)',
  ].join('\n'));
  process.exit(code);
}

async function runSingle(params: {
  repoRoot: string;
  tsNodePath: string;
  opts: BatchOptions;
  scenario: string;
  runIndex: number;
  outDir: string;
}): Promise<RunResult> {
  const started = Date.now();
  const logPath = path.join(params.outDir, 'batch_run.log');
  await fs.promises.mkdir(params.outDir, { recursive: true });
  const logStream = fs.createWriteStream(logPath, { encoding: 'utf8' });

  const args: string[] = [params.tsNodePath, path.join(params.repoRoot, 'scripts', 'botEval.ts')];
  args.push('--scenario', params.scenario);
  args.push('--model', params.opts.model);
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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, '..');
  const tsNodePath = path.join(repoRoot, 'node_modules', 'ts-node', 'dist', 'bin.js');
  if (!fs.existsSync(tsNodePath)) {
    // eslint-disable-next-line no-console
    console.error(`ts-node not found at ${tsNodePath}`);
    process.exit(1);
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
    outDir: batchOutDir,
  };
  await fs.promises.writeFile(path.join(batchOutDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  const results: RunResult[] = [];
  for (const scenario of opts.scenarios) {
    for (let i = 1; i <= opts.runs; i++) {
      const runOutDir = path.join(batchOutDir, `${scenario}_run_${String(i).padStart(2, '0')}`);
      // eslint-disable-next-line no-console
      console.log(`Running ${scenario} (${i}/${opts.runs})...`);
      const res = await runSingle({ repoRoot, tsNodePath, opts, scenario, runIndex: i, outDir: runOutDir });
      results.push(res);
      // eslint-disable-next-line no-console
      console.log(
        `  -> ${res.ok ? 'OK' : 'FAIL'} (${Math.round(res.durationMs / 1000)}s) ${res.outDir}`
      );
    }
  }

  const summary = summarize(results);
  await fs.promises.writeFile(path.join(batchOutDir, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
  await fs.promises.writeFile(path.join(batchOutDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

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
  // eslint-disable-next-line no-console
  console.log(`\nBatch output: ${batchOutDir}`);
}

if (require.main === module) {
  main().catch(err => {
    // eslint-disable-next-line no-console
    console.error('botEvalBatch failed:', err);
    process.exit(1);
  });
}
