import * as fs from 'fs';
import * as path from 'path';

type BenchmarkSplit = 'train' | 'validation' | 'test' | 'regression' | 'holdout';

type ScenarioManifest = {
  splits: BenchmarkSplit[];
  domains: string[];
  capabilities: string[];
  blocking: boolean;
  notes?: string;
};

type BenchmarkManifest = {
  version: number;
  scenarios: Record<string, ScenarioManifest>;
  checkpointPolicy: {
    minRunsInWindow: number;
    gateRequired: boolean;
    requiredSplits: BenchmarkSplit[];
    minPassRate: number;
    minRawRunPassRate: number;
    maxFallbackDependencyRunRate: number;
  };
};

type CheckpointManagerOptions = {
  rootDir: string;
  manifestPath: string;
  window: number;
  outJson: string;
  outMd: string;
  registryPath: string;
  promoteQualifiedLatest: boolean;
};

type SummaryRow = {
  scenario: string;
  passRate: number;
  rawRunPassRate: number;
  fallbackDependencyRunRate: number;
  avgMs: number;
};

type CompareReport = {
  baselineDir?: string;
  gate?: {
    passed?: boolean;
  };
};

type RunArtifacts = {
  dirName: string;
  dirPath: string;
  mtimeMs: number;
  summary: SummaryRow[];
  compare: CompareReport;
};

type MetricStats = {
  mean: number;
  variance: number;
  stddev: number;
  min: number;
  max: number;
  ci95Low: number;
  ci95High: number;
};

type SplitScenarioRollup = {
  scenario: string;
  blocking: boolean;
  samples: number;
  passRate: MetricStats;
  rawRunPassRate: MetricStats;
  fallbackDependencyRunRate: MetricStats;
  avgMs: MetricStats;
  newestPassRate: number;
  oldestPassRate: number;
  passRateDeltaNewestVsOldest: number;
  newestAvgMs: number;
  oldestAvgMs: number;
  avgMsDeltaNewestVsOldest: number;
};

type SplitRollup = {
  split: BenchmarkSplit;
  scenariosExpected: string[];
  scenariosSeen: string[];
  missingScenarios: string[];
  scenarioRollups: SplitScenarioRollup[];
};

type CheckpointEvaluation = {
  qualified: boolean;
  reasons: string[];
  latestRunDir?: string;
  baselineDir?: string;
  latestQualifiedScenarioIds: string[];
};

type CheckpointReport = {
  generatedAt: string;
  manifestVersion: number;
  manifestPath: string;
  rootDir: string;
  window: number;
  inputs: string[];
  baselineDir: string;
  splitRollups: SplitRollup[];
  checkpoint: CheckpointEvaluation;
};

type CheckpointRegistryEntry = {
  id: string;
  createdAt: string;
  manifestVersion: number;
  runDir: string;
  baselineDir: string;
  window: number;
  qualified: boolean;
  reasons: string[];
  scenarios: string[];
};

type CheckpointRegistry = {
  version: 1;
  updatedAt: string;
  activeCheckpointId?: string;
  entries: CheckpointRegistryEntry[];
};

const BENCHMARK_SPLITS: BenchmarkSplit[] = ['train', 'validation', 'test', 'regression', 'holdout'];

const CHECKPOINT_ELIGIBLE_RUN_PATTERNS = [
  /^release_gate_\d+$/,
  /^release_gate_ci_nightly_\d+_\d+$/,
  /^release_gate_stable_nightly$/
];

function parseArgs(argv: string[]): CheckpointManagerOptions {
  const opts: CheckpointManagerOptions = {
    rootDir: path.resolve('projects/bot_eval_run'),
    manifestPath: path.resolve('scripts/config/botEvalBenchmarks.json'),
    window: 10,
    outJson: path.resolve('projects/bot_eval_run/checkpoint_report_latest.json'),
    outMd: path.resolve('projects/bot_eval_run/checkpoint_report_latest.md'),
    registryPath: path.resolve('projects/bot_eval_run/checkpoint_registry.json'),
    promoteQualifiedLatest: false
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => argv[index + 1];
    if (arg === '--root' && next()) {
      opts.rootDir = path.resolve(next());
      index++;
      continue;
    }
    if (arg === '--manifest' && next()) {
      opts.manifestPath = path.resolve(next());
      index++;
      continue;
    }
    if (arg === '--window' && next()) {
      opts.window = Number(next());
      index++;
      continue;
    }
    if (arg === '--out' && next()) {
      opts.outJson = path.resolve(next());
      index++;
      continue;
    }
    if (arg === '--outMd' && next()) {
      opts.outMd = path.resolve(next());
      index++;
      continue;
    }
    if (arg === '--registry' && next()) {
      opts.registryPath = path.resolve(next());
      index++;
      continue;
    }
    if (arg === '--promoteQualifiedLatest') {
      opts.promoteQualifiedLatest = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsageAndExit(0);
    }
  }

  if (!Number.isFinite(opts.window) || opts.window <= 0) {
    throw new Error(`Invalid --window value "${opts.window}". Expected positive integer.`);
  }
  opts.window = Math.floor(opts.window);
  return opts;
}

function printUsageAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.log([
    'Usage: npm run bot:eval:checkpoint -- [options]',
    '',
    'Options:',
    '  --root <dir>                  Root directory with eval runs (default: projects/bot_eval_run)',
    '  --manifest <path>             Benchmark manifest JSON (default: scripts/config/botEvalBenchmarks.json)',
    '  --window <n>                  Number of newest comparable runs to inspect (default: 10)',
    '  --out <path>                  Output JSON report path',
    '  --outMd <path>                Output markdown report path',
    '  --registry <path>             Checkpoint registry path',
    '  --promoteQualifiedLatest      If latest checkpoint qualifies, write/update registry active checkpoint',
    '  -h, --help                    Show this help'
  ].join('\n'));
  process.exit(code);
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function toNumber(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => String(item || '').trim())
    .filter(Boolean);
}

function normalizeSplitArray(value: unknown): BenchmarkSplit[] {
  const seen = new Set<BenchmarkSplit>();
  for (const item of normalizeStringArray(value)) {
    if ((BENCHMARK_SPLITS as string[]).includes(item)) {
      seen.add(item as BenchmarkSplit);
    }
  }
  return [...seen];
}

export function parseBenchmarkManifest(raw: any): BenchmarkManifest {
  const scenariosInput = raw?.scenarios;
  if (!scenariosInput || typeof scenariosInput !== 'object' || Array.isArray(scenariosInput)) {
    throw new Error('Invalid benchmark manifest: scenarios must be an object.');
  }

  const scenarios: Record<string, ScenarioManifest> = {};
  for (const [scenario, value] of Object.entries(scenariosInput)) {
    const splits = normalizeSplitArray((value as any)?.splits);
    if (splits.length === 0) {
      throw new Error(`Invalid benchmark manifest: scenario "${scenario}" must declare at least one split.`);
    }
    scenarios[scenario] = {
      splits,
      domains: normalizeStringArray((value as any)?.domains),
      capabilities: normalizeStringArray((value as any)?.capabilities),
      blocking: Boolean((value as any)?.blocking),
      notes: String((value as any)?.notes || '').trim() || undefined
    };
  }

  const policy = raw?.checkpointPolicy || {};
  const requiredSplits = normalizeSplitArray(policy.requiredSplits);
  return {
    version: Math.max(1, Math.floor(toNumber(raw?.version) || 1)),
    scenarios,
    checkpointPolicy: {
      minRunsInWindow: Math.max(1, Math.floor(toNumber(policy.minRunsInWindow) || 1)),
      gateRequired: policy.gateRequired !== false,
      requiredSplits,
      minPassRate: toNumber(policy.minPassRate),
      minRawRunPassRate: toNumber(policy.minRawRunPassRate),
      maxFallbackDependencyRunRate: Number.isFinite(Number(policy.maxFallbackDependencyRunRate))
        ? Number(policy.maxFallbackDependencyRunRate)
        : 1
    }
  };
}

function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeVariance(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = computeMean(values);
  return values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
}

export function computeConfidenceInterval95(values: number[]): { low: number; high: number } {
  if (values.length === 0) return { low: 0, high: 0 };
  if (values.length === 1) return { low: values[0], high: values[0] };
  const mean = computeMean(values);
  const variance = computeVariance(values);
  const stddev = Math.sqrt(variance);
  const margin = 1.96 * (stddev / Math.sqrt(values.length));
  return {
    low: mean - margin,
    high: mean + margin
  };
}

function buildMetricStats(values: number[]): MetricStats {
  const mean = computeMean(values);
  const variance = computeVariance(values);
  const stddev = Math.sqrt(variance);
  const ci95 = computeConfidenceInterval95(values);
  return {
    mean,
    variance,
    stddev,
    min: values.length > 0 ? Math.min(...values) : 0,
    max: values.length > 0 ? Math.max(...values) : 0,
    ci95Low: ci95.low,
    ci95High: ci95.high
  };
}

function isCheckpointEligibleRunDirName(dirName: string): boolean {
  const normalized = String(dirName || '').trim();
  if (!normalized) return false;
  return CHECKPOINT_ELIGIBLE_RUN_PATTERNS.some(pattern => pattern.test(normalized));
}

function listComparableRunDirs(rootDir: string): RunArtifacts[] {
  if (!fs.existsSync(rootDir)) {
    throw new Error(`Eval run root directory does not exist: ${rootDir}`);
  }

  return fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .filter(entry => isCheckpointEligibleRunDirName(entry.name))
    .map(entry => {
      const dirPath = path.join(rootDir, entry.name);
      const summaryPath = path.join(dirPath, 'summary.json');
      const comparePath = path.join(dirPath, 'compare.json');
      if (!fs.existsSync(summaryPath) || !fs.existsSync(comparePath)) {
        return undefined;
      }
      const summary = readJsonFile<SummaryRow[]>(summaryPath);
      const compare = readJsonFile<CompareReport>(comparePath);
      if (!Array.isArray(summary)) return undefined;
      return {
        dirName: entry.name,
        dirPath,
        mtimeMs: fs.statSync(dirPath).mtimeMs,
        summary,
        compare
      } satisfies RunArtifacts;
    })
    .filter((value): value is RunArtifacts => Boolean(value))
    .sort((left, right) => (right.mtimeMs - left.mtimeMs) || right.dirName.localeCompare(left.dirName));
}

function getSummaryRow(run: RunArtifacts, scenario: string): SummaryRow | undefined {
  return run.summary.find(row => row.scenario === scenario);
}

function buildSplitRollups(runs: RunArtifacts[], manifest: BenchmarkManifest): SplitRollup[] {
  return BENCHMARK_SPLITS.map(split => {
    const scenariosExpected = Object.entries(manifest.scenarios)
      .filter(([, config]) => config.splits.includes(split))
      .map(([scenario]) => scenario)
      .sort();

    const scenarioRollups: SplitScenarioRollup[] = scenariosExpected
      .map(scenario => {
        const rows = runs
          .map(run => ({ run, row: getSummaryRow(run, scenario) }))
          .filter((item): item is { run: RunArtifacts; row: SummaryRow } => Boolean(item.row));

        if (rows.length === 0) return undefined;

        const passRates = rows.map(item => toNumber(item.row.passRate));
        const rawRunPassRates = rows.map(item => toNumber(item.row.rawRunPassRate));
        const fallbackRates = rows.map(item => toNumber(item.row.fallbackDependencyRunRate));
        const avgLatencies = rows.map(item => toNumber(item.row.avgMs));
        const newestRow = rows[0].row;
        const oldestRow = rows[rows.length - 1].row;
        return {
          scenario,
          blocking: manifest.scenarios[scenario].blocking,
          samples: rows.length,
          passRate: buildMetricStats(passRates),
          rawRunPassRate: buildMetricStats(rawRunPassRates),
          fallbackDependencyRunRate: buildMetricStats(fallbackRates),
          avgMs: buildMetricStats(avgLatencies),
          newestPassRate: toNumber(newestRow.passRate),
          oldestPassRate: toNumber(oldestRow.passRate),
          passRateDeltaNewestVsOldest: toNumber(newestRow.passRate) - toNumber(oldestRow.passRate),
          newestAvgMs: toNumber(newestRow.avgMs),
          oldestAvgMs: toNumber(oldestRow.avgMs),
          avgMsDeltaNewestVsOldest: toNumber(newestRow.avgMs) - toNumber(oldestRow.avgMs)
        } satisfies SplitScenarioRollup;
      })
      .filter((value): value is SplitScenarioRollup => Boolean(value));

    const scenariosSeen = scenarioRollups.map(item => item.scenario).sort();
    const missingScenarios = scenariosExpected.filter(scenario => !scenariosSeen.includes(scenario));

    return {
      split,
      scenariosExpected,
      scenariosSeen,
      missingScenarios,
      scenarioRollups
    } satisfies SplitRollup;
  });
}

function evaluateCheckpoint(reportRuns: RunArtifacts[], manifest: BenchmarkManifest): CheckpointEvaluation {
  const reasons: string[] = [];
  const latestRun = reportRuns[0];
  const latestSummaryRows = latestRun?.summary || [];

  if (reportRuns.length < manifest.checkpointPolicy.minRunsInWindow) {
    reasons.push(
      `Need at least ${manifest.checkpointPolicy.minRunsInWindow} comparable runs in the rolling window, found ${reportRuns.length}.`
    );
  }

  if (!latestRun) {
    reasons.push('No comparable runs found.');
  }

  if (latestRun && manifest.checkpointPolicy.gateRequired && !latestRun.compare?.gate?.passed) {
    reasons.push(`${latestRun.dirName}: compare gate did not pass.`);
  }

  const latestQualifiedScenarioIds: string[] = [];
  for (const [scenario, config] of Object.entries(manifest.scenarios)) {
    if (!config.blocking) continue;
    if (!config.splits.some(split => manifest.checkpointPolicy.requiredSplits.includes(split))) continue;
    const row = latestSummaryRows.find(item => item.scenario === scenario);
    if (!row) {
      reasons.push(`Latest comparable run is missing required scenario ${scenario}.`);
      continue;
    }
    if (toNumber(row.passRate) < manifest.checkpointPolicy.minPassRate) {
      reasons.push(`${scenario}: passRate=${toNumber(row.passRate)} below ${manifest.checkpointPolicy.minPassRate}.`);
    }
    if (toNumber(row.rawRunPassRate) < manifest.checkpointPolicy.minRawRunPassRate) {
      reasons.push(
        `${scenario}: rawRunPassRate=${toNumber(row.rawRunPassRate)} below ${manifest.checkpointPolicy.minRawRunPassRate}.`
      );
    }
    if (toNumber(row.fallbackDependencyRunRate) > manifest.checkpointPolicy.maxFallbackDependencyRunRate) {
      reasons.push(
        `${scenario}: fallbackDependencyRunRate=${toNumber(row.fallbackDependencyRunRate)} above ${manifest.checkpointPolicy.maxFallbackDependencyRunRate}.`
      );
    }
    if (
      toNumber(row.passRate) >= manifest.checkpointPolicy.minPassRate &&
      toNumber(row.rawRunPassRate) >= manifest.checkpointPolicy.minRawRunPassRate &&
      toNumber(row.fallbackDependencyRunRate) <= manifest.checkpointPolicy.maxFallbackDependencyRunRate
    ) {
      latestQualifiedScenarioIds.push(scenario);
    }
  }

  return {
    qualified: reasons.length === 0,
    reasons,
    latestRunDir: latestRun?.dirPath,
    baselineDir: String(latestRun?.compare?.baselineDir || '').trim(),
    latestQualifiedScenarioIds: latestQualifiedScenarioIds.sort()
  };
}

export function buildCheckpointReport(params: {
  rootDir: string;
  manifestPath: string;
  window: number;
}): CheckpointReport {
  const manifest = parseBenchmarkManifest(readJsonFile<any>(params.manifestPath));
  const comparableRuns = listComparableRunDirs(params.rootDir).slice(0, params.window);
  if (comparableRuns.length === 0) {
    throw new Error(`No comparable eval runs found in ${params.rootDir}.`);
  }
  const splitRollups = buildSplitRollups(comparableRuns, manifest);
  const checkpoint = evaluateCheckpoint(comparableRuns, manifest);
  const baselineDir = checkpoint.baselineDir || String(comparableRuns[0]?.compare?.baselineDir || '').trim();

  return {
    generatedAt: new Date().toISOString(),
    manifestVersion: manifest.version,
    manifestPath: path.resolve(params.manifestPath),
    rootDir: path.resolve(params.rootDir),
    window: params.window,
    inputs: comparableRuns.map(run => run.dirPath),
    baselineDir,
    splitRollups,
    checkpoint
  };
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMs(value: number): string {
  return `${Math.round(value)}ms`;
}

function buildMarkdown(report: CheckpointReport): string {
  const lines: string[] = [];
  lines.push('# BotEval Checkpoint Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Manifest: ${report.manifestPath} (v${report.manifestVersion})`);
  lines.push(`Window: ${report.window}`);
  lines.push(`Baseline: ${report.baselineDir || 'n/a'}`);
  lines.push(`Checkpoint qualified: ${report.checkpoint.qualified ? 'yes' : 'no'}`);
  lines.push('');

  if (report.checkpoint.reasons.length > 0) {
    lines.push('## Qualification blockers');
    for (const reason of report.checkpoint.reasons) {
      lines.push(`- ${reason}`);
    }
    lines.push('');
  }

  for (const split of report.splitRollups) {
    lines.push(`## Split: ${split.split}`);
    lines.push('');
    lines.push(`Expected scenarios: ${split.scenariosExpected.join(', ') || 'none'}`);
    lines.push(`Seen scenarios: ${split.scenariosSeen.join(', ') || 'none'}`);
    lines.push(`Missing scenarios: ${split.missingScenarios.join(', ') || 'none'}`);
    lines.push('');
    if (split.scenarioRollups.length > 0) {
      lines.push('| Scenario | Samples | passRate mean ± CI95 | rawRunPassRate mean ± CI95 | fallback mean ± CI95 | latency mean ± CI95 | newest-oldest pass | newest-oldest latency |');
      lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
      for (const scenario of split.scenarioRollups) {
        lines.push(
          `| ${scenario.scenario} | ${scenario.samples} | ` +
          `${formatPct(scenario.passRate.mean)} (${formatPct(scenario.passRate.ci95Low)}-${formatPct(scenario.passRate.ci95High)}) | ` +
          `${formatPct(scenario.rawRunPassRate.mean)} (${formatPct(scenario.rawRunPassRate.ci95Low)}-${formatPct(scenario.rawRunPassRate.ci95High)}) | ` +
          `${formatPct(scenario.fallbackDependencyRunRate.mean)} (${formatPct(scenario.fallbackDependencyRunRate.ci95Low)}-${formatPct(scenario.fallbackDependencyRunRate.ci95High)}) | ` +
          `${formatMs(scenario.avgMs.mean)} (${formatMs(scenario.avgMs.ci95Low)}-${formatMs(scenario.avgMs.ci95High)}) | ` +
          `${formatPct(scenario.passRateDeltaNewestVsOldest)} | ` +
          `${formatMs(scenario.avgMsDeltaNewestVsOldest)} |`
        );
      }
      lines.push('');
    }
  }

  lines.push('## Inputs');
  for (const input of report.inputs) {
    lines.push(`- ${input}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function updateCheckpointRegistry(
  registryPath: string,
  report: CheckpointReport,
  promoteQualifiedLatest: boolean
): CheckpointRegistry {
  const latestRunDir = String(report.checkpoint.latestRunDir || '').trim();
  const checkpointId = latestRunDir
    ? `${path.win32.basename(latestRunDir)}@manifest-v${report.manifestVersion}`
    : `checkpoint-${Date.now()}`;
  const existing: CheckpointRegistry = fs.existsSync(registryPath)
    ? readJsonFile<CheckpointRegistry>(registryPath)
    : { version: 1, updatedAt: new Date().toISOString(), entries: [] };

  const entry: CheckpointRegistryEntry = {
    id: checkpointId,
    createdAt: report.generatedAt,
    manifestVersion: report.manifestVersion,
    runDir: latestRunDir,
    baselineDir: report.baselineDir,
    window: report.window,
    qualified: report.checkpoint.qualified,
    reasons: [...report.checkpoint.reasons],
    scenarios: [...report.checkpoint.latestQualifiedScenarioIds]
  };

  const filteredEntries = existing.entries.filter(item => item.id !== entry.id);
  const updated: CheckpointRegistry = {
    version: 1,
    updatedAt: report.generatedAt,
    activeCheckpointId: promoteQualifiedLatest && report.checkpoint.qualified
      ? entry.id
      : existing.activeCheckpointId,
    entries: [entry, ...filteredEntries]
  };

  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

export async function runCheckpointManager(options: CheckpointManagerOptions): Promise<CheckpointReport> {
  const report = buildCheckpointReport({
    rootDir: options.rootDir,
    manifestPath: options.manifestPath,
    window: options.window
  });

  await fs.promises.mkdir(path.dirname(options.outJson), { recursive: true });
  await fs.promises.writeFile(options.outJson, JSON.stringify(report, null, 2), 'utf8');
  await fs.promises.writeFile(options.outMd, buildMarkdown(report), 'utf8');
  updateCheckpointRegistry(options.registryPath, report, options.promoteQualifiedLatest);
  return report;
}

if (require.main === module) {
  runCheckpointManager(parseArgs(process.argv.slice(2))).catch((error: any) => {
    // eslint-disable-next-line no-console
    console.error(error?.stack || String(error));
    process.exit(1);
  });
}
