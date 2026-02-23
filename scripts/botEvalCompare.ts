import * as fs from 'fs';
import * as path from 'path';

import { collectFailureClustersForRun, summarize } from './botEvalBatch';

type CompareOptions = {
  baselineDir: string;
  candidateDir: string;
  outPath?: string;
  topClusters: number;
  gateEnabled: boolean;
  gateConfigPath?: string;
  minPassRateDelta?: number;
  maxFallbackDependencyRunRate?: number;
  maxFallbackDependencyRunRateDelta?: number;
  maxClusterIncreaseRules: GateClusterThreshold[];
  scenarioThresholdsFile?: string;
  scenarioThresholds: Record<string, ScenarioThresholdRule>;
};

type ScenarioDelta = {
  scenario: string;
  baseline: {
    passRate: number;
    rawRunPassRate: number;
    fallbackDependencyRunRate: number;
    avgMs: number;
    topFailureClusters: Array<{ id: string; count: number }>;
  };
  candidate: {
    passRate: number;
    rawRunPassRate: number;
    fallbackDependencyRunRate: number;
    avgMs: number;
    topFailureClusters: Array<{ id: string; count: number }>;
  };
  delta: {
    passRate: number;
    rawRunPassRate: number;
    fallbackDependencyRunRate: number;
    avgMs: number;
  };
};

type ClusterDelta = {
  id: string;
  baseline: number;
  candidate: number;
  delta: number;
};

type CompareReport = {
  generatedAt: string;
  baselineDir: string;
  candidateDir: string;
  scenarios: ScenarioDelta[];
  clusterDelta: ClusterDelta[];
  gate: GateEvaluation;
};

type GateClusterThreshold = {
  id: string;
  maxIncrease: number;
};

type ScenarioThresholdRule = {
  minPassRateDelta?: number;
  maxFallbackDependencyRunRate?: number;
  maxFallbackDependencyRunRateDelta?: number;
};

type GateThresholds = {
  minPassRateDelta: number;
  maxFallbackDependencyRunRate: number;
  maxFallbackDependencyRunRateDelta: number;
  maxClusterIncreaseRules: GateClusterThreshold[];
  scenarioOverrides: Record<string, ScenarioThresholdRule>;
};

type GateViolation = {
  scope: 'scenario' | 'cluster';
  scenario?: string;
  metric: string;
  actual: number;
  expected: number;
  message: string;
};

type GateEvaluation = {
  enabled: boolean;
  passed: boolean;
  thresholds: GateThresholds;
  violations: GateViolation[];
};

type GateConfigFile = {
  minPassRateDelta?: number;
  maxFallbackDependencyRunRate?: number;
  maxFallbackDependencyRunRateDelta?: number;
  maxClusterIncreaseRules?: GateClusterThreshold[];
  scenarioOverrides?: Record<string, ScenarioThresholdRule>;
};

function parseArgs(argv: string[]): CompareOptions {
  const opts: CompareOptions = {
    baselineDir: '',
    candidateDir: '',
    outPath: undefined,
    topClusters: 12,
    gateEnabled: false,
    gateConfigPath: undefined,
    minPassRateDelta: undefined,
    maxFallbackDependencyRunRate: undefined,
    maxFallbackDependencyRunRateDelta: undefined,
    maxClusterIncreaseRules: [],
    scenarioThresholdsFile: undefined,
    scenarioThresholds: {}
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[i + 1];
    if (a === '--baseline' && next()) {
      opts.baselineDir = next();
      i++;
      continue;
    }
    if (a === '--candidate' && next()) {
      opts.candidateDir = next();
      i++;
      continue;
    }
    if (a === '--out' && next()) {
      opts.outPath = next();
      i++;
      continue;
    }
    if (a === '--topClusters' && next()) {
      opts.topClusters = Number(next());
      i++;
      continue;
    }
    if (a === '--gate') {
      opts.gateEnabled = true;
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
      const parsed = parseClusterIncreaseRule(next());
      opts.maxClusterIncreaseRules.push(parsed);
      i++;
      continue;
    }
    if (a === '--scenarioThresholdsFile' && next()) {
      opts.scenarioThresholdsFile = next();
      i++;
      continue;
    }
    if (a === '--scenarioThreshold' && next()) {
      const parsed = parseScenarioThresholdRule(next());
      opts.scenarioThresholds[parsed.scenario] = {
        minPassRateDelta: parsed.minPassRateDelta,
        maxFallbackDependencyRunRate: parsed.maxFallbackDependencyRunRate,
        maxFallbackDependencyRunRateDelta: parsed.maxFallbackDependencyRunRateDelta
      };
      i++;
      continue;
    }
    if (a === '--help' || a === '-h') {
      printUsageAndExit(0);
    }
  }

  if (!opts.baselineDir || !opts.candidateDir) {
    printUsageAndExit(1);
  }
  if (!Number.isFinite(opts.topClusters) || opts.topClusters <= 0) {
    opts.topClusters = 12;
  }
  if (opts.gateEnabled) {
    if (!Number.isFinite(opts.minPassRateDelta)) opts.minPassRateDelta = 0;
    if (!Number.isFinite(opts.maxFallbackDependencyRunRate)) opts.maxFallbackDependencyRunRate = 0.9;
    if (!Number.isFinite(opts.maxFallbackDependencyRunRateDelta)) opts.maxFallbackDependencyRunRateDelta = 0.2;
  }
  return opts;
}

function parseClusterIncreaseRule(raw: string): GateClusterThreshold {
  const text = String(raw || '').trim();
  const idx = text.lastIndexOf(':');
  if (idx <= 0 || idx === text.length - 1) {
    throw new Error(`Invalid --maxClusterIncrease value "${raw}". Expected <clusterId>:<number>`);
  }
  const id = text.slice(0, idx).trim();
  const maxIncrease = Number(text.slice(idx + 1).trim());
  if (!id) throw new Error(`Invalid --maxClusterIncrease value "${raw}". Missing cluster id.`);
  if (!Number.isFinite(maxIncrease)) {
    throw new Error(`Invalid --maxClusterIncrease value "${raw}". Increase must be numeric.`);
  }
  return { id, maxIncrease };
}

function normalizeClusterIncreaseRules(raw: any): GateClusterThreshold[] {
  if (!Array.isArray(raw)) return [];
  const out: GateClusterThreshold[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      out.push(parseClusterIncreaseRule(item));
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const id = String((item as any).id || '').trim();
    const maxIncrease = Number((item as any).maxIncrease);
    if (!id || !Number.isFinite(maxIncrease)) continue;
    out.push({ id, maxIncrease });
  }
  return out;
}

function parseOptionalNumberToken(token: string): number | undefined {
  const value = String(token || '').trim();
  if (!value || value === '-' || value === '*' || value.toLowerCase() === 'default') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric value "${token}"`);
  return n;
}

function parseScenarioThresholdRule(raw: string): {
  scenario: string;
  minPassRateDelta?: number;
  maxFallbackDependencyRunRate?: number;
  maxFallbackDependencyRunRateDelta?: number;
} {
  const text = String(raw || '').trim();
  const parts = text.split(':');
  if (parts.length !== 4) {
    throw new Error(
      `Invalid --scenarioThreshold value "${raw}". Expected <scenario>:<minPassRateDelta>:<maxFallbackDependencyRunRate>:<maxFallbackDependencyRunRateDelta>`
    );
  }
  const scenario = String(parts[0] || '').trim();
  if (!scenario) throw new Error(`Invalid --scenarioThreshold value "${raw}". Missing scenario id.`);
  return {
    scenario,
    minPassRateDelta: parseOptionalNumberToken(parts[1]),
    maxFallbackDependencyRunRate: parseOptionalNumberToken(parts[2]),
    maxFallbackDependencyRunRateDelta: parseOptionalNumberToken(parts[3])
  };
}

function normalizeScenarioThresholdMap(raw: any): Record<string, ScenarioThresholdRule> {
  const out: Record<string, ScenarioThresholdRule> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [scenario, value] of Object.entries(raw)) {
    if (!scenario.trim()) continue;
    const item = value as any;
    if (!item || typeof item !== 'object') continue;
    const next: ScenarioThresholdRule = {};
    if (item.minPassRateDelta != null && Number.isFinite(Number(item.minPassRateDelta))) {
      next.minPassRateDelta = Number(item.minPassRateDelta);
    }
    if (item.maxFallbackDependencyRunRate != null && Number.isFinite(Number(item.maxFallbackDependencyRunRate))) {
      next.maxFallbackDependencyRunRate = Number(item.maxFallbackDependencyRunRate);
    }
    if (item.maxFallbackDependencyRunRateDelta != null && Number.isFinite(Number(item.maxFallbackDependencyRunRateDelta))) {
      next.maxFallbackDependencyRunRateDelta = Number(item.maxFallbackDependencyRunRateDelta);
    }
    out[scenario] = next;
  }
  return out;
}

function printUsageAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.log([
    'Usage: npm run bot:eval:compare -- --baseline <batchDir> --candidate <batchDir> [options]',
    '',
    'Options:',
    '  --baseline <dir>      Baseline batch directory (must contain results.json)',
    '  --candidate <dir>     Candidate batch directory (must contain results.json)',
    '  --out <path>          Output compare report JSON path (default: <candidate>/compare.json)',
    '  --topClusters <n>     Number of cluster deltas in report (default: 12)',
    '  --gate                Enable acceptance gate (non-zero exit code when violated)',
    '  --gateConfig <path>   JSON config with gate thresholds (globals + scenario overrides)',
    '  --minPassRateDelta <n>                 Minimum allowed pass-rate delta per scenario (default: 0)',
    '  --maxFallbackDependencyRunRate <n>     Max candidate fallbackDependencyRunRate per scenario (default: 0.9)',
    '  --maxFallbackDependencyRunRateDelta <n> Max allowed delta of fallbackDependencyRunRate (default: 0.2)',
    '  --maxClusterIncrease <cluster:delta>   Max allowed increase for specific failure cluster (repeatable)',
    '  --scenarioThresholdsFile <path>        JSON file with per-scenario gate thresholds',
    '  --scenarioThreshold <scenario:min:max:delta>  Inline per-scenario thresholds (repeatable, "-" keeps global default)',
  ].join('\n'));
  process.exit(code);
}

function readJsonFile(absPath: string): any {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function loadGateConfigFile(absPath: string): GateConfigFile {
  const raw = readJsonFile(absPath);
  if (!raw || typeof raw !== 'object') return {};
  return {
    minPassRateDelta: Number.isFinite(Number((raw as any).minPassRateDelta))
      ? Number((raw as any).minPassRateDelta)
      : undefined,
    maxFallbackDependencyRunRate: Number.isFinite(Number((raw as any).maxFallbackDependencyRunRate))
      ? Number((raw as any).maxFallbackDependencyRunRate)
      : undefined,
    maxFallbackDependencyRunRateDelta: Number.isFinite(Number((raw as any).maxFallbackDependencyRunRateDelta))
      ? Number((raw as any).maxFallbackDependencyRunRateDelta)
      : undefined,
    maxClusterIncreaseRules: normalizeClusterIncreaseRules((raw as any).maxClusterIncreaseRules),
    scenarioOverrides: normalizeScenarioThresholdMap((raw as any).scenarioOverrides)
  };
}

function loadResults(batchDir: string): any[] {
  const absDir = path.resolve(batchDir);
  const resultsPath = path.join(absDir, 'results.json');
  if (!fs.existsSync(resultsPath)) {
    throw new Error(`Missing results.json in ${absDir}`);
  }
  const data = readJsonFile(resultsPath);
  if (!Array.isArray(data)) {
    throw new Error(`Invalid results.json in ${absDir}: expected array`);
  }
  return data;
}

function mapSummaryByScenario(rows: any[]): Map<string, any> {
  const out = new Map<string, any>();
  for (const row of rows) {
    const scenario = String(row?.scenario || '');
    if (!scenario) continue;
    out.set(scenario, row);
  }
  return out;
}

function toNumber(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function aggregateClusters(results: any[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const run of results) {
    if (run?.ok) continue;
    const clusters = collectFailureClustersForRun(run);
    for (const cluster of clusters) {
      const id = String(cluster.id || 'other');
      const value = Number(cluster.count) || 0;
      if (value <= 0) continue;
      counts.set(id, (counts.get(id) || 0) + value);
    }
  }
  return counts;
}

function buildClusterDelta(baseline: Map<string, number>, candidate: Map<string, number>): ClusterDelta[] {
  const ids = new Set<string>([...baseline.keys(), ...candidate.keys()]);
  return [...ids]
    .map(id => {
      const base = baseline.get(id) || 0;
      const cand = candidate.get(id) || 0;
      return {
        id,
        baseline: base,
        candidate: cand,
        delta: cand - base
      };
    })
    .sort((a, b) => (Math.abs(b.delta) - Math.abs(a.delta)) || (b.candidate - a.candidate) || a.id.localeCompare(b.id));
}

export function compareSummaries(params: {
  baselineSummaryRows: any[];
  candidateSummaryRows: any[];
}): ScenarioDelta[] {
  const baselineByScenario = mapSummaryByScenario(params.baselineSummaryRows);
  const candidateByScenario = mapSummaryByScenario(params.candidateSummaryRows);
  const scenarios = new Set<string>([...baselineByScenario.keys(), ...candidateByScenario.keys()]);
  const deltas: ScenarioDelta[] = [];

  for (const scenario of scenarios) {
    const baseline = baselineByScenario.get(scenario) || {};
    const candidate = candidateByScenario.get(scenario) || {};
    const baselinePassRate = toNumber(baseline.passRate);
    const candidatePassRate = toNumber(candidate.passRate);
    const baselineRawRunPassRate = toNumber(baseline.rawRunPassRate);
    const candidateRawRunPassRate = toNumber(candidate.rawRunPassRate);
    const baselineFallbackDependencyRunRate = toNumber(baseline.fallbackDependencyRunRate);
    const candidateFallbackDependencyRunRate = toNumber(candidate.fallbackDependencyRunRate);
    const baselineAvgMs = toNumber(baseline.avgMs);
    const candidateAvgMs = toNumber(candidate.avgMs);
    deltas.push({
      scenario,
      baseline: {
        passRate: baselinePassRate,
        rawRunPassRate: baselineRawRunPassRate,
        fallbackDependencyRunRate: baselineFallbackDependencyRunRate,
        avgMs: baselineAvgMs,
        topFailureClusters: Array.isArray(baseline.topFailureClusters) ? baseline.topFailureClusters : []
      },
      candidate: {
        passRate: candidatePassRate,
        rawRunPassRate: candidateRawRunPassRate,
        fallbackDependencyRunRate: candidateFallbackDependencyRunRate,
        avgMs: candidateAvgMs,
        topFailureClusters: Array.isArray(candidate.topFailureClusters) ? candidate.topFailureClusters : []
      },
      delta: {
        passRate: candidatePassRate - baselinePassRate,
        rawRunPassRate: candidateRawRunPassRate - baselineRawRunPassRate,
        fallbackDependencyRunRate: candidateFallbackDependencyRunRate - baselineFallbackDependencyRunRate,
        avgMs: candidateAvgMs - baselineAvgMs
      }
    });
  }

  return deltas.sort((a, b) => a.scenario.localeCompare(b.scenario));
}

export function evaluateAcceptanceGate(params: {
  enabled: boolean;
  scenarios: ScenarioDelta[];
  clusterDelta: ClusterDelta[];
  thresholds?: {
    minPassRateDelta?: number;
    maxFallbackDependencyRunRate?: number;
    maxFallbackDependencyRunRateDelta?: number;
    maxClusterIncreaseRules?: GateClusterThreshold[];
    scenarioOverrides?: Record<string, ScenarioThresholdRule>;
  };
}): GateEvaluation {
  const thresholds: GateThresholds = {
    minPassRateDelta: Number.isFinite(Number(params.thresholds?.minPassRateDelta))
      ? Number(params.thresholds?.minPassRateDelta)
      : 0,
    maxFallbackDependencyRunRate: Number.isFinite(Number(params.thresholds?.maxFallbackDependencyRunRate))
      ? Number(params.thresholds?.maxFallbackDependencyRunRate)
      : 0.9,
    maxFallbackDependencyRunRateDelta: Number.isFinite(Number(params.thresholds?.maxFallbackDependencyRunRateDelta))
      ? Number(params.thresholds?.maxFallbackDependencyRunRateDelta)
      : 0.2,
    maxClusterIncreaseRules: Array.isArray(params.thresholds?.maxClusterIncreaseRules)
      ? params.thresholds!.maxClusterIncreaseRules!.map(rule => ({ id: String(rule.id), maxIncrease: Number(rule.maxIncrease) }))
      : [],
    scenarioOverrides: normalizeScenarioThresholdMap(params.thresholds?.scenarioOverrides || {})
  };

  if (!params.enabled) {
    return {
      enabled: false,
      passed: true,
      thresholds,
      violations: []
    };
  }

  const violations: GateViolation[] = [];
  for (const row of params.scenarios) {
    const scenarioOverride = thresholds.scenarioOverrides[row.scenario] || {};
    const minPassRateDelta = scenarioOverride.minPassRateDelta ?? thresholds.minPassRateDelta;
    const maxFallbackDependencyRunRate = scenarioOverride.maxFallbackDependencyRunRate ?? thresholds.maxFallbackDependencyRunRate;
    const maxFallbackDependencyRunRateDelta =
      scenarioOverride.maxFallbackDependencyRunRateDelta ?? thresholds.maxFallbackDependencyRunRateDelta;

    if (row.delta.passRate < minPassRateDelta) {
      violations.push({
        scope: 'scenario',
        scenario: row.scenario,
        metric: 'passRateDelta',
        actual: row.delta.passRate,
        expected: minPassRateDelta,
        message: `Scenario ${row.scenario}: passRateDelta ${row.delta.passRate.toFixed(4)} is below minimum ${minPassRateDelta.toFixed(4)}`
      });
    }
    if (row.candidate.fallbackDependencyRunRate > maxFallbackDependencyRunRate) {
      violations.push({
        scope: 'scenario',
        scenario: row.scenario,
        metric: 'fallbackDependencyRunRate',
        actual: row.candidate.fallbackDependencyRunRate,
        expected: maxFallbackDependencyRunRate,
        message: `Scenario ${row.scenario}: fallbackDependencyRunRate ${row.candidate.fallbackDependencyRunRate.toFixed(4)} exceeds max ${maxFallbackDependencyRunRate.toFixed(4)}`
      });
    }
    if (row.delta.fallbackDependencyRunRate > maxFallbackDependencyRunRateDelta) {
      violations.push({
        scope: 'scenario',
        scenario: row.scenario,
        metric: 'fallbackDependencyRunRateDelta',
        actual: row.delta.fallbackDependencyRunRate,
        expected: maxFallbackDependencyRunRateDelta,
        message: `Scenario ${row.scenario}: fallbackDependencyRunRateDelta ${row.delta.fallbackDependencyRunRate.toFixed(4)} exceeds max ${maxFallbackDependencyRunRateDelta.toFixed(4)}`
      });
    }
  }

  if (thresholds.maxClusterIncreaseRules.length > 0) {
    const deltaMap = new Map(params.clusterDelta.map(item => [item.id, item.delta]));
    for (const rule of thresholds.maxClusterIncreaseRules) {
      const actual = Number(deltaMap.get(rule.id) || 0);
      if (actual > rule.maxIncrease) {
        violations.push({
          scope: 'cluster',
          metric: `clusterDelta:${rule.id}`,
          actual,
          expected: rule.maxIncrease,
          message: `Cluster ${rule.id}: delta ${actual.toFixed(4)} exceeds max increase ${rule.maxIncrease.toFixed(4)}`
        });
      }
    }
  }

  return {
    enabled: true,
    passed: violations.length === 0,
    thresholds,
    violations
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const baselineDir = path.resolve(opts.baselineDir);
  const candidateDir = path.resolve(opts.candidateDir);
  let gateConfig: GateConfigFile = {};
  if (opts.gateConfigPath) {
    gateConfig = loadGateConfigFile(path.resolve(opts.gateConfigPath));
  }
  if (opts.gateEnabled) {
    if (opts.minPassRateDelta == null && gateConfig.minPassRateDelta != null) {
      opts.minPassRateDelta = gateConfig.minPassRateDelta;
    }
    if (opts.maxFallbackDependencyRunRate == null && gateConfig.maxFallbackDependencyRunRate != null) {
      opts.maxFallbackDependencyRunRate = gateConfig.maxFallbackDependencyRunRate;
    }
    if (opts.maxFallbackDependencyRunRateDelta == null && gateConfig.maxFallbackDependencyRunRateDelta != null) {
      opts.maxFallbackDependencyRunRateDelta = gateConfig.maxFallbackDependencyRunRateDelta;
    }
    if (opts.maxClusterIncreaseRules.length === 0 && Array.isArray(gateConfig.maxClusterIncreaseRules)) {
      opts.maxClusterIncreaseRules = gateConfig.maxClusterIncreaseRules;
    }
  }
  if (gateConfig.scenarioOverrides && Object.keys(gateConfig.scenarioOverrides).length > 0) {
    opts.scenarioThresholds = { ...gateConfig.scenarioOverrides, ...opts.scenarioThresholds };
  }
  if (opts.scenarioThresholdsFile) {
    const scenarioThresholdsPath = path.resolve(opts.scenarioThresholdsFile);
    const fromFile = normalizeScenarioThresholdMap(readJsonFile(scenarioThresholdsPath));
    opts.scenarioThresholds = { ...fromFile, ...opts.scenarioThresholds };
  }
  const baselineResults = loadResults(baselineDir);
  const candidateResults = loadResults(candidateDir);

  const baselineSummary = summarize(baselineResults as any);
  const candidateSummary = summarize(candidateResults as any);
  const scenarios = compareSummaries({
    baselineSummaryRows: baselineSummary,
    candidateSummaryRows: candidateSummary
  });

  const baselineClusters = aggregateClusters(baselineResults);
  const candidateClusters = aggregateClusters(candidateResults);
  const clusterDeltaAll = buildClusterDelta(baselineClusters, candidateClusters);
  const clusterDelta = clusterDeltaAll.slice(0, opts.topClusters);
  const gate = evaluateAcceptanceGate({
    enabled: opts.gateEnabled,
    scenarios,
    clusterDelta: clusterDeltaAll,
    thresholds: {
      minPassRateDelta: opts.minPassRateDelta,
      maxFallbackDependencyRunRate: opts.maxFallbackDependencyRunRate,
      maxFallbackDependencyRunRateDelta: opts.maxFallbackDependencyRunRateDelta,
      maxClusterIncreaseRules: opts.maxClusterIncreaseRules,
      scenarioOverrides: opts.scenarioThresholds
    }
  });

  const report: CompareReport = {
    generatedAt: new Date().toISOString(),
    baselineDir,
    candidateDir,
    scenarios,
    clusterDelta,
    gate
  };

  const outPath = path.resolve(opts.outPath || path.join(candidateDir, 'compare.json'));
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

  // eslint-disable-next-line no-console
  console.log('Scenario deltas:');
  for (const row of report.scenarios) {
    // eslint-disable-next-line no-console
    console.log(
      `- ${row.scenario}: passRateDelta=${Math.round(row.delta.passRate * 100)}pp` +
      ` rawRunPassRateDelta=${Math.round(row.delta.rawRunPassRate * 100)}pp` +
      ` fallbackDependencyRunRateDelta=${Math.round(row.delta.fallbackDependencyRunRate * 100)}pp` +
      ` avgMsDelta=${Math.round(row.delta.avgMs)}`
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    `Top cluster deltas: ${
      report.clusterDelta.map(c => `${c.id}:${c.delta > 0 ? '+' : ''}${c.delta}`).join(', ') || 'n/a'
    }`
  );
  if (gate.enabled) {
    // eslint-disable-next-line no-console
    console.log(`Gate: ${gate.passed ? 'PASS' : 'FAIL'} (${gate.violations.length} violation(s))`);
    for (const violation of gate.violations) {
      // eslint-disable-next-line no-console
      console.log(`  - ${violation.message}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`Compare report: ${outPath}`);
  if (gate.enabled && !gate.passed) {
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main().catch(err => {
    // eslint-disable-next-line no-console
    console.error('botEvalCompare failed:', err);
    process.exit(1);
  });
}
