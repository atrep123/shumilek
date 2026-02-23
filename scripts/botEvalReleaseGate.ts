import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

type ReleaseGateOptions = {
  baselineDir: string;
  baselinePointerPath?: string;
  lockBaseline: boolean;
  outDir?: string;
  compareOut?: string;
  runs: number;
  scenarios: string[];
  model: string;
  plannerModel?: string;
  reviewerModel?: string;
  jsonRepairModel?: string;
  deterministicFallbackMode: 'off' | 'on-fail' | 'always';
  timeoutSec: number;
  maxIterations: number;
  hardTimeoutSec?: number;
  topClusters: number;
  gateConfigPath?: string;
  minPassRateDelta?: number;
  maxFallbackDependencyRunRate?: number;
  maxFallbackDependencyRunRateDelta?: number;
  maxClusterIncreaseRules: string[];
  scenarioThresholdsFile?: string;
  scenarioThresholdRules: string[];
};

function normalizeDeterministicFallbackMode(raw?: string): 'off' | 'on-fail' | 'always' {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'off' || value === 'always' || value === 'on-fail') return value;
  return 'on-fail';
}

function parseArgs(argv: string[]): ReleaseGateOptions {
  const opts: ReleaseGateOptions = {
    baselineDir: '',
    baselinePointerPath: undefined,
    lockBaseline: false,
    outDir: undefined,
    compareOut: undefined,
    runs: 10,
    scenarios: ['ts-todo-oracle', 'node-api-oracle', 'python-ai-stdlib-oracle'],
    model: process.env.BOT_EVAL_MODEL || 'qwen2.5-coder:14b',
    plannerModel: process.env.BOT_EVAL_PLANNER_MODEL || 'deepseek-r1:8b',
    reviewerModel: process.env.BOT_EVAL_REVIEWER_MODEL || 'qwen2.5:3b',
    jsonRepairModel: process.env.BOT_EVAL_JSON_REPAIR_MODEL || 'qwen2.5:7b',
    deterministicFallbackMode: normalizeDeterministicFallbackMode(process.env.BOT_EVAL_DETERMINISTIC_FALLBACK),
    timeoutSec: Number(process.env.BOT_EVAL_TIMEOUT_SEC || 1200),
    maxIterations: Number(process.env.BOT_EVAL_MAX_ITERATIONS || 6),
    hardTimeoutSec: Number(process.env.BOT_EVAL_HARD_TIMEOUT_SEC || 1200),
    topClusters: 12,
    gateConfigPath: process.env.BOT_EVAL_GATE_CONFIG || undefined,
    minPassRateDelta: undefined,
    maxFallbackDependencyRunRate: undefined,
    maxFallbackDependencyRunRateDelta: undefined,
    maxClusterIncreaseRules: [],
    scenarioThresholdsFile: undefined,
    scenarioThresholdRules: []
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[i + 1];
    if (a === '--baseline' && next()) {
      opts.baselineDir = next();
      i++;
      continue;
    }
    if (a === '--baselinePointer' && next()) {
      opts.baselinePointerPath = next();
      i++;
      continue;
    }
    if (a === '--lockBaseline') {
      opts.lockBaseline = true;
      continue;
    }
    if (a === '--outDir' && next()) {
      opts.outDir = next();
      i++;
      continue;
    }
    if (a === '--compareOut' && next()) {
      opts.compareOut = next();
      i++;
      continue;
    }
    if (a === '--runs' && next()) {
      opts.runs = Number(next());
      i++;
      continue;
    }
    if (a === '--scenarios' && next()) {
      opts.scenarios = next().split(',').map(s => s.trim()).filter(Boolean);
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
    if (a === '--topClusters' && next()) {
      opts.topClusters = Number(next());
      i++;
      continue;
    }
    if (a === '--gateConfig' && next()) {
      opts.gateConfigPath = next();
      i++;
      continue;
    }
    if (a === '--minPassRateDelta' && next()) {
      opts.minPassRateDelta = Number(next());
      i++;
      continue;
    }
    if (a === '--maxFallbackDependencyRunRate' && next()) {
      opts.maxFallbackDependencyRunRate = Number(next());
      i++;
      continue;
    }
    if (a === '--maxFallbackDependencyRunRateDelta' && next()) {
      opts.maxFallbackDependencyRunRateDelta = Number(next());
      i++;
      continue;
    }
    if (a === '--maxClusterIncrease' && next()) {
      opts.maxClusterIncreaseRules.push(next());
      i++;
      continue;
    }
    if (a === '--scenarioThresholdsFile' && next()) {
      opts.scenarioThresholdsFile = next();
      i++;
      continue;
    }
    if (a === '--scenarioThreshold' && next()) {
      opts.scenarioThresholdRules.push(next());
      i++;
      continue;
    }
    if (a === '--help' || a === '-h') {
      printUsageAndExit(0);
    }
  }

  if (!Number.isFinite(opts.runs) || opts.runs <= 0) opts.runs = 10;
  if (!Number.isFinite(opts.timeoutSec) || opts.timeoutSec <= 0) opts.timeoutSec = 1200;
  if (!Number.isFinite(opts.maxIterations) || opts.maxIterations <= 0) opts.maxIterations = 6;
  if (!Number.isFinite(opts.hardTimeoutSec) || opts.hardTimeoutSec! <= 0) opts.hardTimeoutSec = 1200;
  if (!Number.isFinite(opts.topClusters) || opts.topClusters <= 0) opts.topClusters = 12;
  if (opts.scenarios.length === 0) {
    opts.scenarios = ['ts-todo-oracle', 'node-api-oracle', 'python-ai-stdlib-oracle'];
  }
  return opts;
}

export function parseReleaseGateArgs(argv: string[]): ReleaseGateOptions {
  return parseArgs(argv);
}

export function resolveReleaseGateBaselineDir(params: {
  baselineDir?: string;
  baselinePointerPath: string;
}): string {
  let baselineDirRaw = String(params.baselineDir || '').trim();
  if (!baselineDirRaw && fs.existsSync(params.baselinePointerPath)) {
    baselineDirRaw = String(fs.readFileSync(params.baselinePointerPath, 'utf8') || '').trim();
  }
  if (!baselineDirRaw) {
    throw new Error(
      `Baseline not provided. Use --baseline <dir> or create pointer file ${params.baselinePointerPath}`
    );
  }
  return path.resolve(baselineDirRaw);
}

function printUsageAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.log([
    'Usage: npm run bot:eval:release-gate -- [--baseline <batchDir>] [options]',
    '',
    'Runs batch benchmark and immediately evaluates compare gate against baseline.',
    '',
    'Batch options:',
    '  --baseline <dir>           Baseline batch directory (optional when baseline pointer exists)',
    '  --baselinePointer <path>   Path to baseline pointer file (default: projects/bot_eval_run/release_baseline.txt)',
    '  --lockBaseline             On PASS, write candidate dir into baseline pointer file',
    '  --runs <n>                 Runs per scenario (default: 10)',
    '  --scenarios <csv>          Scenario ids (default: ts-todo-oracle,node-api-oracle,python-ai-stdlib-oracle)',
    '  --model <name>             Model (default: qwen2.5-coder:14b)',
    '  --plannerModel <name>      Planner model',
    '  --reviewerModel <name>     Reviewer model',
    '  --jsonRepairModel <name>   JSON repair model',
    '  --deterministicFallback <mode>  off|on-fail|always (default: on-fail)',
    '  --timeoutSec <n>           Request timeout seconds (default: 1200)',
    '  --maxIterations <n>        Max iterations (default: 6)',
    '  --hardTimeoutSec <n>       Hard timeout per run (default: 1200)',
    '  --outDir <path>            Candidate batch output directory',
    '',
    'Gate options (forwarded to compare):',
    '  --topClusters <n>          Number of cluster deltas in report (default: 12)',
    '  --gateConfig <path>        JSON config with gate thresholds',
    '  --minPassRateDelta <n>',
    '  --maxFallbackDependencyRunRate <n>',
    '  --maxFallbackDependencyRunRateDelta <n>',
    '  --maxClusterIncrease <cluster:delta>   Repeatable',
    '  --scenarioThresholdsFile <path>',
    '  --scenarioThreshold <scenario:min:max:delta>   Repeatable',
    '  --compareOut <path>        compare.json output path',
  ].join('\n'));
  process.exit(code);
}

async function runNodeCommand(args: string[], cwd: string): Promise<number> {
  return await new Promise<number>(resolve => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: process.env,
      stdio: 'inherit'
    });
    child.on('close', code => resolve(typeof code === 'number' ? code : 1));
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, '..');
  const baselinePointerPath = path.resolve(
    opts.baselinePointerPath || path.join(repoRoot, 'projects', 'bot_eval_run', 'release_baseline.txt')
  );
  const tsNodePath = path.join(repoRoot, 'node_modules', 'ts-node', 'dist', 'bin.js');
  if (!fs.existsSync(tsNodePath)) {
    throw new Error(`ts-node not found at ${tsNodePath}`);
  }

  const baselineDir = resolveReleaseGateBaselineDir({
    baselineDir: opts.baselineDir,
    baselinePointerPath
  });
  const baselineResults = path.join(baselineDir, 'results.json');
  if (!fs.existsSync(baselineResults)) {
    throw new Error(`Baseline batch missing results.json: ${baselineResults}`);
  }

  const candidateDir = path.resolve(
    opts.outDir || path.join(repoRoot, 'projects', 'bot_eval_run', `release_gate_${Date.now()}`)
  );
  await fs.promises.mkdir(candidateDir, { recursive: true });

  const batchArgs: string[] = [
    tsNodePath,
    path.join(repoRoot, 'scripts', 'botEvalBatch.ts'),
    '--runs', String(opts.runs),
    '--scenarios', opts.scenarios.join(','),
    '--model', opts.model,
    '--deterministicFallback', opts.deterministicFallbackMode,
    '--timeoutSec', String(opts.timeoutSec),
    '--maxIterations', String(opts.maxIterations),
    '--hardTimeoutSec', String(opts.hardTimeoutSec),
    '--outDir', candidateDir
  ];
  if (opts.plannerModel) batchArgs.push('--plannerModel', opts.plannerModel);
  if (opts.reviewerModel) batchArgs.push('--reviewerModel', opts.reviewerModel);
  if (opts.jsonRepairModel) batchArgs.push('--jsonRepairModel', opts.jsonRepairModel);

  // eslint-disable-next-line no-console
  console.log(`Running release benchmark batch -> ${candidateDir}`);
  const batchCode = await runNodeCommand(batchArgs, repoRoot);
  if (batchCode !== 0) {
    process.exitCode = batchCode;
    return;
  }

  const compareArgs: string[] = [
    tsNodePath,
    path.join(repoRoot, 'scripts', 'botEvalCompare.ts'),
    '--baseline', baselineDir,
    '--candidate', candidateDir,
    '--gate',
    '--topClusters', String(opts.topClusters)
  ];
  if (opts.gateConfigPath) compareArgs.push('--gateConfig', opts.gateConfigPath);
  if (opts.compareOut) compareArgs.push('--out', opts.compareOut);
  if (Number.isFinite(opts.minPassRateDelta)) compareArgs.push('--minPassRateDelta', String(opts.minPassRateDelta));
  if (Number.isFinite(opts.maxFallbackDependencyRunRate)) {
    compareArgs.push('--maxFallbackDependencyRunRate', String(opts.maxFallbackDependencyRunRate));
  }
  if (Number.isFinite(opts.maxFallbackDependencyRunRateDelta)) {
    compareArgs.push('--maxFallbackDependencyRunRateDelta', String(opts.maxFallbackDependencyRunRateDelta));
  }
  for (const rule of opts.maxClusterIncreaseRules) {
    compareArgs.push('--maxClusterIncrease', rule);
  }
  if (opts.scenarioThresholdsFile) {
    compareArgs.push('--scenarioThresholdsFile', opts.scenarioThresholdsFile);
  }
  for (const rule of opts.scenarioThresholdRules) {
    compareArgs.push('--scenarioThreshold', rule);
  }

  // eslint-disable-next-line no-console
  console.log(`Running release compare gate against baseline -> ${baselineDir}`);
  const compareCode = await runNodeCommand(compareArgs, repoRoot);
  if (compareCode !== 0) {
    process.exitCode = compareCode;
    return;
  }

  if (opts.lockBaseline) {
    await fs.promises.mkdir(path.dirname(baselinePointerPath), { recursive: true });
    await fs.promises.writeFile(baselinePointerPath, candidateDir + '\n', 'utf8');
    // eslint-disable-next-line no-console
    console.log(`Baseline pointer updated: ${baselinePointerPath} -> ${candidateDir}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Release gate PASS. Candidate batch: ${candidateDir}`);
}

if (require.main === module) {
  main().catch(err => {
    // eslint-disable-next-line no-console
    console.error('botEvalReleaseGate failed:', err);
    process.exit(1);
  });
}
