import * as fs from 'fs';
import * as path from 'path';

type BatchSummaryRow = {
  scenario: string;
  passRate: number;
  rawRunPassRate: number;
  fallbackDependencyRunRate: number;
  avgMs: number;
};

type CompareScenario = {
  scenario: string;
  delta: {
    passRate: number;
    rawRunPassRate: number;
    fallbackDependencyRunRate: number;
    avgMs: number;
  };
};

type CompareReport = {
  gate?: {
    passed?: boolean;
    violations?: Array<{ message?: string }>;
  };
  scenarios: CompareScenario[];
};

type AggregateScenario = {
  scenario: string;
  rawRunPassRate: { min: number; max: number };
  fallbackDependencyRunRate: { min: number; max: number };
  avgMsDeltaVsBaseline: { avg: number; min: number; max: number };
};

type AggregateReport = {
  allGatePassed: boolean;
  gateFailures: Array<{ runDir: string; message: string }>;
  scenarios: AggregateScenario[];
};

type NightlySummaryOptions = {
  gateDir: string;
  repairDir?: string;
  outPath?: string;
  append: boolean;
};

type NightlySummaryDeps = {
  now?: () => string;
  log?: (message: string) => void;
};

function printUsageAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.log([
    'Usage: ts-node scripts/botEvalNightlySummary.ts --gateDir <dir> [options]',
    '',
    'Options:',
    '  --gateDir <dir>       Nightly release gate output directory',
    '  --repairDir <dir>     Optional repair canary output directory',
    '  --out <path>          Optional file to write markdown into',
    '  --append              Append to --out instead of overwrite',
    '  -h, --help            Show this help'
  ].join('\n'));
  process.exit(code);
}

function parseArgs(argv: string[]): NightlySummaryOptions {
  const opts: NightlySummaryOptions = {
    gateDir: '',
    repairDir: undefined,
    outPath: undefined,
    append: false
  };

  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    const next = () => argv[i + 1];
    if ((value === '--gateDir' || value === '--gate-dir') && next()) {
      opts.gateDir = path.resolve(next());
      i++;
      continue;
    }
    if ((value === '--repairDir' || value === '--repair-dir') && next()) {
      opts.repairDir = path.resolve(next());
      i++;
      continue;
    }
    if (value === '--out' && next()) {
      opts.outPath = path.resolve(next());
      i++;
      continue;
    }
    if (value === '--append') {
      opts.append = true;
      continue;
    }
    if (value === '--help' || value === '-h') {
      printUsageAndExit(0);
    }
  }

  if (!opts.gateDir) {
    printUsageAndExit(1);
  }

  return opts;
}

export function parseNightlySummaryArgs(argv: string[]): NightlySummaryOptions {
  return parseArgs(argv);
}

function readJsonIfExists<T>(filePath: string): T | null {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function toPct(value: number): string {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function toSignedPct(value: number): string {
  const rounded = Math.round((Number(value) || 0) * 100);
  if (rounded > 0) return `+${rounded}%`;
  return `${rounded}%`;
}

function toSignedMs(value: number): string {
  const rounded = Math.round(Number(value) || 0);
  if (rounded > 0) return `+${rounded}`;
  return `${rounded}`;
}

function toMs(value: number): string {
  return `${Math.round(Number(value) || 0)}`;
}

function buildNightlyGateSection(params: {
  summaryRows: BatchSummaryRow[] | null;
  compare: CompareReport | null;
  aggregate: AggregateReport | null;
}): string[] {
  const lines = ['## Nightly Gate', ''];
  const { summaryRows, compare, aggregate } = params;
  const aggregateScenarios = Array.isArray(aggregate?.scenarios) ? aggregate.scenarios : [];
  const aggregateGateFailures = Array.isArray(aggregate?.gateFailures) ? aggregate.gateFailures : [];
  if (!summaryRows || !compare) {
    lines.push('Nightly gate summary is incomplete. Missing summary.json or compare.json.');
    return lines;
  }

  const gatePassed = compare.gate?.passed !== false;
  lines.push(`Release gate: ${gatePassed ? 'PASS' : 'FAIL'}`);
  if (aggregate) {
    lines.push(`Stability aggregate: ${aggregate.allGatePassed ? 'PASS' : 'FAIL'}`);
  }
  lines.push('');

  if (Array.isArray(compare.gate?.violations) && compare.gate!.violations.length > 0) {
    lines.push('Gate violations:');
    for (const violation of compare.gate!.violations.slice(0, 5)) {
      lines.push(`- ${String(violation?.message || 'Unknown gate violation')}`);
    }
    lines.push('');
  }

  const compareByScenario = new Map((compare.scenarios || []).map(row => [row.scenario, row]));
  lines.push('| Scenario | Pass rate | Raw run pass | Fallback dep | Avg latency (ms) | Pass delta | Raw delta | Fallback delta | Latency delta (ms) |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of summaryRows) {
    const delta = compareByScenario.get(row.scenario)?.delta;
    lines.push(
      `| ${row.scenario} | ${toPct(row.passRate)} | ${toPct(row.rawRunPassRate)} | ${toPct(row.fallbackDependencyRunRate)} | ${toMs(row.avgMs)} | ${toSignedPct(delta?.passRate || 0)} | ${toSignedPct(delta?.rawRunPassRate || 0)} | ${toSignedPct(delta?.fallbackDependencyRunRate || 0)} | ${toSignedMs(delta?.avgMs || 0)} |`
    );
  }

  if (aggregateScenarios.length > 0) {
    lines.push('');
    lines.push('| Trend scenario | Raw min | Raw max | Fallback max | Avg latency delta max (ms) |');
    lines.push('| --- | ---: | ---: | ---: | ---: |');
    for (const row of aggregateScenarios) {
      lines.push(
        `| ${row.scenario} | ${toPct(row.rawRunPassRate.min)} | ${toPct(row.rawRunPassRate.max)} | ${toPct(row.fallbackDependencyRunRate.max)} | ${toSignedMs(row.avgMsDeltaVsBaseline.max)} |`
      );
    }
  }

  if (aggregateGateFailures.length > 0) {
    lines.push('');
    lines.push('Aggregate gate failures:');
    for (const failure of aggregateGateFailures.slice(0, 5)) {
      lines.push(`- ${failure.message}`);
    }
  }

  return lines;
}

function buildRepairSection(summaryRows: BatchSummaryRow[] | null, repairDir?: string): string[] {
  const lines = ['## Repair Canary', ''];
  if (!repairDir) {
    lines.push('Repair canary directory was not provided.');
    return lines;
  }
  if (!summaryRows) {
    lines.push('Repair canary summary was not produced. The batch is non-blocking; check the repair canary step logs for warnings.');
    return lines;
  }
  if (summaryRows.length === 0) {
    lines.push('Repair canary summary was empty.');
    return lines;
  }

  lines.push('| Scenario | Pass rate | Raw run pass rate | Fallback dependency | Avg latency (ms) |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const row of summaryRows) {
    lines.push(
      `| ${row.scenario} | ${toPct(row.passRate)} | ${toPct(row.rawRunPassRate)} | ${toPct(row.fallbackDependencyRunRate)} | ${toMs(row.avgMs)} |`
    );
  }
  return lines;
}

export function buildNightlySummaryMarkdown(params: {
  gateSummaryRows: BatchSummaryRow[] | null;
  compare: CompareReport | null;
  aggregate: AggregateReport | null;
  repairSummaryRows: BatchSummaryRow[] | null;
  repairDir?: string;
  generatedAt?: string;
}): string {
  const lines: string[] = [];
  if (params.generatedAt) {
    lines.push(`Generated: ${params.generatedAt}`);
    lines.push('');
  }
  lines.push(...buildNightlyGateSection({
    summaryRows: params.gateSummaryRows,
    compare: params.compare,
    aggregate: params.aggregate
  }));
  lines.push('');
  lines.push(...buildRepairSection(params.repairSummaryRows, params.repairDir));
  lines.push('');
  return lines.join('\n');
}

export async function runNightlySummary(
  opts: NightlySummaryOptions,
  deps: NightlySummaryDeps = {}
): Promise<{ markdown: string; outPath?: string }> {
  const log = deps.log || (message => console.log(message));
  const now = deps.now || (() => new Date().toISOString());

  const gateSummaryRows = readJsonIfExists<BatchSummaryRow[]>(path.join(opts.gateDir, 'summary.json'));
  const compare = readJsonIfExists<CompareReport>(path.join(opts.gateDir, 'compare.json'));
  const aggregate = readJsonIfExists<AggregateReport>(path.join(opts.gateDir, 'stability_aggregate.json'));
  const repairSummaryRows = opts.repairDir
    ? readJsonIfExists<BatchSummaryRow[]>(path.join(opts.repairDir, 'summary.json'))
    : null;

  const markdown = buildNightlySummaryMarkdown({
    gateSummaryRows,
    compare,
    aggregate,
    repairSummaryRows,
    repairDir: opts.repairDir,
    generatedAt: now()
  });

  if (opts.outPath) {
    fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
    if (opts.append) {
      fs.appendFileSync(opts.outPath, markdown, 'utf8');
    } else {
      fs.writeFileSync(opts.outPath, markdown, 'utf8');
    }
    log(`Nightly summary written to ${opts.outPath}`);
  } else {
    log(markdown);
  }

  return { markdown, outPath: opts.outPath };
}

if (require.main === module) {
  runNightlySummary(parseArgs(process.argv.slice(2))).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}