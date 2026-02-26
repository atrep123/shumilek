import * as fs from 'fs';
import * as path from 'path';

type CalibrateOptions = {
  rootDir: string;
  window: number;
  outJson: string;
  outMd: string;
};

type CompareScenario = {
  scenario: string;
  baseline: { avgMs: number };
  candidate: { avgMs: number };
};

type CompareReport = {
  baselineDir: string;
  gate?: {
    passed?: boolean;
  };
  scenarios: CompareScenario[];
};

type StabilityScenario = {
  scenario: string;
  rawRunPassRate: { min: number };
  fallbackDependencyRunRate: { max: number };
  parseErrorRunsTotal: {
    planner: number;
    jsonRepair: number;
    schema: number;
    jsonParse: number;
    placeholder: number;
    other: number;
  };
};

type StabilityAggregateReport = {
  allGatePassed: boolean;
  scenarios: StabilityScenario[];
};

type NightlyRun = {
  dirName: string;
  dirPath: string;
  summary: any[];
  compare: CompareReport;
  stabilityAggregate: StabilityAggregateReport;
};

type CalibrationScenario = {
  scenario: string;
  latencyRatioP95: number;
  recommendedLatencyMultiplier: number;
  samples: number;
};

type CalibrationReadiness = {
  ready_to_tighten_pr: boolean;
  reason_if_not_ready: string;
  last3NightlyRunIds: string[];
};

export type CalibrationRecommendation = {
  generatedAt: string;
  window: number;
  inputs: string[];
  baselineDir: string;
  scenarios: CalibrationScenario[];
  readiness: CalibrationReadiness;
};

type RunDirInfo = {
  dirName: string;
  dirPath: string;
  mtimeMs: number;
};

function parseArgs(argv: string[]): CalibrateOptions {
  const opts: CalibrateOptions = {
    rootDir: path.resolve('projects/bot_eval_run'),
    window: 10,
    outJson: path.resolve('projects/bot_eval_run/calibration_recommendation_latest.json'),
    outMd: path.resolve('projects/bot_eval_run/calibration_recommendation_latest.md')
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[i + 1];
    if (a === '--window' && next()) {
      opts.window = Number(next());
      i++;
      continue;
    }
    if (a === '--root' && next()) {
      opts.rootDir = path.resolve(next());
      i++;
      continue;
    }
    if (a === '--out' && next()) {
      opts.outJson = path.resolve(next());
      i++;
      continue;
    }
    if (a === '--outMd' && next()) {
      opts.outMd = path.resolve(next());
      i++;
      continue;
    }
    if (a === '--help' || a === '-h') {
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
    'Usage: npm run bot:eval:nightly:calibrate -- [options]',
    '',
    'Options:',
    '  --window <n>   Number of newest nightly runs to inspect (default: 10)',
    '  --root <dir>   Root directory with nightly runs (default: projects/bot_eval_run)',
    '  --out <path>   Output JSON report path',
    '  --outMd <path> Output markdown report path',
    '  -h, --help     Show this help',
  ].join('\n'));
  process.exit(code);
}

function readJsonFile<T>(filePath: string): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch (err: any) {
    throw new Error(`Failed to read JSON ${filePath}: ${String(err?.message || err)}`);
  }
}

function toNumber(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getNightlyRunId(dirName: string): string {
  const match = /^release_gate_ci_nightly_(\d+)(?:_\d+)?$/i.exec(dirName);
  return match?.[1] || dirName;
}

export function computePercentile(values: number[], percentile: number): number {
  const nums = values.filter(v => Number.isFinite(v));
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const clampedPercentile = Math.max(0, Math.min(1, percentile));
  const rank = Math.ceil(clampedPercentile * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

export function roundUp(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(step) || step <= 0) return value;
  const decimals = Math.max(0, String(step).split('.')[1]?.length || 0);
  const rounded = Math.ceil((value - 1e-12) / step) * step;
  return Number(rounded.toFixed(decimals));
}

export function computeRecommendedLatencyMultiplier(p95LatencyRatio: number): number {
  return roundUp(p95LatencyRatio * 1.15, 0.01);
}

function listLatestNightlyRunDirs(rootDir: string, window: number): RunDirInfo[] {
  if (!fs.existsSync(rootDir)) {
    throw new Error(`Nightly run root directory does not exist: ${rootDir}`);
  }
  const dirs = fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^release_gate_ci_nightly_/i.test(d.name))
    .map(d => {
      const dirPath = path.join(rootDir, d.name);
      return {
        dirName: d.name,
        dirPath,
        mtimeMs: fs.statSync(dirPath).mtimeMs
      };
    })
    .sort((a, b) => (b.mtimeMs - a.mtimeMs) || b.dirName.localeCompare(a.dirName))
    .slice(0, window);

  if (dirs.length === 0) {
    throw new Error(`No nightly run directories found in ${rootDir}`);
  }
  return dirs;
}

function loadNightlyRun(dir: RunDirInfo): NightlyRun {
  const summaryPath = path.join(dir.dirPath, 'summary.json');
  const comparePath = path.join(dir.dirPath, 'compare.json');
  const stabilityPath = path.join(dir.dirPath, 'stability_aggregate.json');
  if (!fs.existsSync(summaryPath)) throw new Error(`Missing summary.json: ${summaryPath}`);
  if (!fs.existsSync(comparePath)) throw new Error(`Missing compare.json: ${comparePath}`);
  if (!fs.existsSync(stabilityPath)) throw new Error(`Missing stability_aggregate.json: ${stabilityPath}`);

  const summary = readJsonFile<any[]>(summaryPath);
  const compare = readJsonFile<CompareReport>(comparePath);
  const stabilityAggregate = readJsonFile<StabilityAggregateReport>(stabilityPath);
  if (!Array.isArray(summary)) throw new Error(`Invalid summary.json: expected array in ${summaryPath}`);
  if (!Array.isArray(compare?.scenarios)) throw new Error(`Invalid compare.json: expected scenarios[] in ${comparePath}`);
  if (!Array.isArray(stabilityAggregate?.scenarios)) {
    throw new Error(`Invalid stability_aggregate.json: expected scenarios[] in ${stabilityPath}`);
  }

  return {
    dirName: dir.dirName,
    dirPath: dir.dirPath,
    summary,
    compare,
    stabilityAggregate
  };
}

function evaluateReadiness(runsNewestFirst: NightlyRun[]): CalibrationReadiness {
  const last3 = runsNewestFirst.slice(0, 3);
  const violations: string[] = [];
  if (last3.length < 3) {
    violations.push(`Need at least 3 nightly runs for readiness, found ${last3.length}.`);
  }

  for (const run of last3) {
    if (!run.compare?.gate?.passed) {
      violations.push(`${run.dirName}: gate.passed is false`);
    }
    if (!run.stabilityAggregate?.allGatePassed) {
      violations.push(`${run.dirName}: allGatePassed is false`);
    }
    for (const scenario of run.stabilityAggregate?.scenarios || []) {
      const rawMin = toNumber(scenario?.rawRunPassRate?.min);
      if (rawMin < 1) {
        violations.push(`${run.dirName}/${scenario.scenario}: rawRunPassRate.min=${rawMin}, expected 1`);
      }
      const fallbackMax = toNumber(scenario?.fallbackDependencyRunRate?.max);
      if (fallbackMax > 0) {
        violations.push(`${run.dirName}/${scenario.scenario}: fallbackDependencyRunRate.max=${fallbackMax}, expected 0`);
      }
      const parse = scenario?.parseErrorRunsTotal || ({} as any);
      const parseTotal =
        toNumber(parse.planner) +
        toNumber(parse.jsonRepair) +
        toNumber(parse.schema) +
        toNumber(parse.jsonParse) +
        toNumber(parse.placeholder) +
        toNumber(parse.other);
      if (parseTotal > 0) {
        violations.push(`${run.dirName}/${scenario.scenario}: parseErrorRunsTotal=${parseTotal}, expected 0`);
      }
    }
  }

  return {
    ready_to_tighten_pr: violations.length === 0,
    reason_if_not_ready: violations.join(' | '),
    last3NightlyRunIds: last3.map(run => getNightlyRunId(run.dirName))
  };
}

function buildMarkdown(report: CalibrationRecommendation): string {
  const lines: string[] = [];
  lines.push('# Nightly Calibration Recommendation');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Window: ${report.window}`);
  lines.push(`Baseline: ${report.baselineDir || 'n/a'}`);
  lines.push('');
  lines.push('## Scenario latency recommendation');
  lines.push('');
  lines.push('| Scenario | p95(avgMs ratio) | Recommended multiplier (p95 * 1.15, round-up 0.01) | Samples |');
  lines.push('|---|---:|---:|---:|');
  for (const row of report.scenarios) {
    lines.push(
      `| ${row.scenario} | ${row.latencyRatioP95.toFixed(4)} | ${row.recommendedLatencyMultiplier.toFixed(2)} | ${row.samples} |`
    );
  }
  lines.push('');
  lines.push('## Readiness');
  lines.push('');
  lines.push(`- ready_to_tighten_pr: ${report.readiness.ready_to_tighten_pr}`);
  lines.push(`- reason_if_not_ready: ${report.readiness.reason_if_not_ready || 'n/a'}`);
  lines.push(`- last3NightlyRunIds: ${report.readiness.last3NightlyRunIds.join(', ') || 'n/a'}`);
  lines.push('');
  lines.push('## Inputs');
  for (const input of report.inputs) {
    lines.push(`- ${input}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function buildCalibrationRecommendation(params: {
  rootDir: string;
  window: number;
}): CalibrationRecommendation {
  const runDirs = listLatestNightlyRunDirs(params.rootDir, params.window);
  const runs = runDirs.map(loadNightlyRun);
  const ratiosByScenario = new Map<string, number[]>();

  for (const run of runs) {
    for (const scenario of run.compare.scenarios) {
      const baselineAvgMs = toNumber(scenario?.baseline?.avgMs);
      const candidateAvgMs = toNumber(scenario?.candidate?.avgMs);
      if (baselineAvgMs <= 0) {
        throw new Error(`Invalid baseline.avgMs for scenario ${scenario.scenario} in ${run.dirName}`);
      }
      const ratio = candidateAvgMs / baselineAvgMs;
      if (!ratiosByScenario.has(scenario.scenario)) ratiosByScenario.set(scenario.scenario, []);
      ratiosByScenario.get(scenario.scenario)!.push(ratio);
    }
  }

  const scenarios: CalibrationScenario[] = [...ratiosByScenario.entries()]
    .map(([scenario, ratios]) => {
      const p95 = computePercentile(ratios, 0.95);
      return {
        scenario,
        latencyRatioP95: p95,
        recommendedLatencyMultiplier: computeRecommendedLatencyMultiplier(p95),
        samples: ratios.length
      };
    })
    .sort((a, b) => a.scenario.localeCompare(b.scenario));

  return {
    generatedAt: new Date().toISOString(),
    window: params.window,
    inputs: runs.map(run => run.dirPath),
    baselineDir: runs[0]?.compare?.baselineDir || '',
    scenarios,
    readiness: evaluateReadiness(runs)
  };
}

export async function runNightlyCalibration(opts: CalibrateOptions): Promise<CalibrationRecommendation> {
  const report = buildCalibrationRecommendation({
    rootDir: opts.rootDir,
    window: opts.window
  });

  await fs.promises.mkdir(path.dirname(opts.outJson), { recursive: true });
  await fs.promises.writeFile(opts.outJson, JSON.stringify(report, null, 2), 'utf8');
  await fs.promises.writeFile(opts.outMd, buildMarkdown(report), 'utf8');
  return report;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report = await runNightlyCalibration(opts);
  // eslint-disable-next-line no-console
  console.log(`Calibration JSON: ${opts.outJson}`);
  // eslint-disable-next-line no-console
  console.log(`Calibration MD:   ${opts.outMd}`);
  // eslint-disable-next-line no-console
  console.log(`ready_to_tighten_pr=${report.readiness.ready_to_tighten_pr}`);
}

if (require.main === module) {
  main().catch(err => {
    // eslint-disable-next-line no-console
    console.error('botEvalNightlyCalibrate failed:', err);
    process.exit(1);
  });
}
