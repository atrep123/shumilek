import * as fs from 'fs';
import * as path from 'path';

type SummaryScenario = {
  scenario: string;
  passRate: number;
  rawRunPassRate: number;
  fallbackDependencyRunRate: number;
  avgMs: number;
  runsWithPlannerError: number;
  runsWithJsonRepairError: number;
  runsWithSchemaFailure: number;
  runsWithJsonParseFailure: number;
  runsWithPlaceholderFailure: number;
  runsWithOtherParseFailure: number;
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
  generatedAt: string;
  baselineDir: string;
  candidateDir: string;
  scenarios: CompareScenario[];
  gate?: {
    passed?: boolean;
    violations?: Array<{ message?: string }>;
  };
};

type AggregateScenario = {
  scenario: string;
  runs: number;
  passRate: { avg: number; min: number; max: number };
  rawRunPassRate: { avg: number; min: number; max: number };
  fallbackDependencyRunRate: { avg: number; min: number; max: number };
  avgMs: { avg: number; min: number; max: number };
  avgMsDeltaVsBaseline: { avg: number; min: number; max: number };
  parseErrorRunsTotal: {
    planner: number;
    jsonRepair: number;
    schema: number;
    jsonParse: number;
    placeholder: number;
    other: number;
  };
};

type AggregateReport = {
  generatedAt: string;
  inputs: string[];
  baselineDir: string;
  allGatePassed: boolean;
  gateFailures: Array<{ runDir: string; message: string }>;
  scenarios: AggregateScenario[];
};

function parseArgs(argv: string[]): { inputs: string[]; outJson: string; outMd: string } {
  const inputs: string[] = [];
  let outJson = path.resolve('projects/bot_eval_run/long_stability_aggregate_latest.json');
  let outMd = path.resolve('projects/bot_eval_run/long_stability_aggregate_latest.md');

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[i + 1];
    if (a === '--input' && next()) {
      inputs.push(path.resolve(next()));
      i++;
      continue;
    }
    if (a === '--inputs' && next()) {
      const split = next().split(',').map(s => s.trim()).filter(Boolean);
      for (const p of split) inputs.push(path.resolve(p));
      i++;
      continue;
    }
    if (a === '--out' && next()) {
      outJson = path.resolve(next());
      i++;
      continue;
    }
    if (a === '--outMd' && next()) {
      outMd = path.resolve(next());
      i++;
      continue;
    }
    if (a === '--help' || a === '-h') {
      printUsageAndExit(0);
    }
  }

  if (inputs.length === 0) {
    const root = path.resolve('projects/bot_eval_run');
    if (fs.existsSync(root)) {
      const candidates = fs.readdirSync(root, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^long_stability_run[A-Z]_/.test(d.name))
        .map(d => path.join(root, d.name))
        .sort();
      inputs.push(...candidates);
    }
  }

  if (inputs.length === 0) {
    throw new Error('No input directories. Use --input <dir> (repeat) or --inputs <dir1,dir2,...>.');
  }

  return { inputs, outJson, outMd };
}

function printUsageAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.log([
    'Usage: ts-node scripts/botEvalStabilityAggregate.ts [options]',
    '',
    'Options:',
    '  --input <dir>          Add input run directory (repeatable)',
    '  --inputs <csv>         Add comma-separated input run directories',
    '  --out <path>           Output JSON report path',
    '  --outMd <path>         Output markdown report path',
    '  -h, --help             Show this help',
  ].join('\n'));
  process.exit(code);
}

function readJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function min(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => (a < b ? a : b), values[0]);
}

function max(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => (a > b ? a : b), values[0]);
}

function toPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function toMs(n: number): string {
  return `${Math.round(n)}ms`;
}

function buildMarkdown(report: AggregateReport): string {
  const lines: string[] = [];
  lines.push('# BotEval Long Stability Aggregate');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Baseline: ${report.baselineDir}`);
  lines.push(`Inputs: ${report.inputs.length}`);
  lines.push(`All gates passed: ${report.allGatePassed ? 'yes' : 'no'}`);
  lines.push('');

  if (report.gateFailures.length > 0) {
    lines.push('## Gate Failures');
    for (const fail of report.gateFailures) {
      lines.push(`- ${fail.runDir}: ${fail.message}`);
    }
    lines.push('');
  }

  lines.push('## Scenario Summary');
  lines.push('');
  lines.push('| Scenario | passRate avg(min-max) | rawRunPassRate avg(min-max) | fallbackDep avg(min-max) | avgMs avg(min-max) | avgMsDelta avg(min-max) | parse error runs (planner/jsonRepair/schema/jsonParse/placeholder/other) |');
  lines.push('|---|---:|---:|---:|---:|---:|---|');
  for (const s of report.scenarios) {
    const parse = s.parseErrorRunsTotal;
    lines.push(
      `| ${s.scenario} | ` +
      `${toPct(s.passRate.avg)} (${toPct(s.passRate.min)}-${toPct(s.passRate.max)}) | ` +
      `${toPct(s.rawRunPassRate.avg)} (${toPct(s.rawRunPassRate.min)}-${toPct(s.rawRunPassRate.max)}) | ` +
      `${toPct(s.fallbackDependencyRunRate.avg)} (${toPct(s.fallbackDependencyRunRate.min)}-${toPct(s.fallbackDependencyRunRate.max)}) | ` +
      `${toMs(s.avgMs.avg)} (${toMs(s.avgMs.min)}-${toMs(s.avgMs.max)}) | ` +
      `${toMs(s.avgMsDeltaVsBaseline.avg)} (${toMs(s.avgMsDeltaVsBaseline.min)}-${toMs(s.avgMsDeltaVsBaseline.max)}) | ` +
      `${parse.planner}/${parse.jsonRepair}/${parse.schema}/${parse.jsonParse}/${parse.placeholder}/${parse.other} |`
    );
  }
  lines.push('');
  lines.push('## Inputs');
  for (const input of report.inputs) {
    lines.push(`- ${input}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const scenarioAcc = new Map<string, {
    passRate: number[];
    rawRunPassRate: number[];
    fallbackDependencyRunRate: number[];
    avgMs: number[];
    avgMsDeltaVsBaseline: number[];
    plannerErrRuns: number;
    jsonRepairErrRuns: number;
    schemaFailRuns: number;
    jsonParseFailRuns: number;
    placeholderFailRuns: number;
    otherFailRuns: number;
    runs: number;
  }>();

  let baselineDir = '';
  let allGatePassed = true;
  const gateFailures: Array<{ runDir: string; message: string }> = [];

  for (const input of opts.inputs) {
    const summaryPath = path.join(input, 'summary.json');
    const comparePath = path.join(input, 'compare.json');
    if (!fs.existsSync(summaryPath)) throw new Error(`Missing summary.json: ${summaryPath}`);
    if (!fs.existsSync(comparePath)) throw new Error(`Missing compare.json: ${comparePath}`);

    const summary = readJsonFile<SummaryScenario[]>(summaryPath);
    const compare = readJsonFile<CompareReport>(comparePath);
    const compareByScenario = new Map(compare.scenarios.map(s => [s.scenario, s]));

    if (!baselineDir) baselineDir = compare.baselineDir || '';
    if (baselineDir && compare.baselineDir && baselineDir !== compare.baselineDir) {
      throw new Error(`Baseline mismatch: ${baselineDir} vs ${compare.baselineDir} in ${input}`);
    }

    const gatePassed = Boolean(compare.gate?.passed);
    if (!gatePassed) {
      allGatePassed = false;
      const violations = (compare.gate?.violations || []).map(v => v.message || 'unknown violation');
      gateFailures.push({
        runDir: input,
        message: violations.join(' | ') || 'gate failed'
      });
    }

    for (const row of summary) {
      const cmp = compareByScenario.get(row.scenario);
      const acc = scenarioAcc.get(row.scenario) || {
        passRate: [],
        rawRunPassRate: [],
        fallbackDependencyRunRate: [],
        avgMs: [],
        avgMsDeltaVsBaseline: [],
        plannerErrRuns: 0,
        jsonRepairErrRuns: 0,
        schemaFailRuns: 0,
        jsonParseFailRuns: 0,
        placeholderFailRuns: 0,
        otherFailRuns: 0,
        runs: 0
      };
      acc.passRate.push(Number(row.passRate) || 0);
      acc.rawRunPassRate.push(Number(row.rawRunPassRate) || 0);
      acc.fallbackDependencyRunRate.push(Number(row.fallbackDependencyRunRate) || 0);
      acc.avgMs.push(Number(row.avgMs) || 0);
      acc.avgMsDeltaVsBaseline.push(Number(cmp?.delta?.avgMs) || 0);
      acc.plannerErrRuns += Number(row.runsWithPlannerError) || 0;
      acc.jsonRepairErrRuns += Number(row.runsWithJsonRepairError) || 0;
      acc.schemaFailRuns += Number(row.runsWithSchemaFailure) || 0;
      acc.jsonParseFailRuns += Number(row.runsWithJsonParseFailure) || 0;
      acc.placeholderFailRuns += Number(row.runsWithPlaceholderFailure) || 0;
      acc.otherFailRuns += Number(row.runsWithOtherParseFailure) || 0;
      acc.runs += 1;
      scenarioAcc.set(row.scenario, acc);
    }
  }

  const scenarios: AggregateScenario[] = Array.from(scenarioAcc.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([scenario, acc]) => ({
      scenario,
      runs: acc.runs,
      passRate: { avg: avg(acc.passRate), min: min(acc.passRate), max: max(acc.passRate) },
      rawRunPassRate: { avg: avg(acc.rawRunPassRate), min: min(acc.rawRunPassRate), max: max(acc.rawRunPassRate) },
      fallbackDependencyRunRate: {
        avg: avg(acc.fallbackDependencyRunRate),
        min: min(acc.fallbackDependencyRunRate),
        max: max(acc.fallbackDependencyRunRate)
      },
      avgMs: { avg: avg(acc.avgMs), min: min(acc.avgMs), max: max(acc.avgMs) },
      avgMsDeltaVsBaseline: {
        avg: avg(acc.avgMsDeltaVsBaseline),
        min: min(acc.avgMsDeltaVsBaseline),
        max: max(acc.avgMsDeltaVsBaseline)
      },
      parseErrorRunsTotal: {
        planner: acc.plannerErrRuns,
        jsonRepair: acc.jsonRepairErrRuns,
        schema: acc.schemaFailRuns,
        jsonParse: acc.jsonParseFailRuns,
        placeholder: acc.placeholderFailRuns,
        other: acc.otherFailRuns
      }
    }));

  const report: AggregateReport = {
    generatedAt: new Date().toISOString(),
    inputs: opts.inputs,
    baselineDir,
    allGatePassed,
    gateFailures,
    scenarios
  };

  await fs.promises.mkdir(path.dirname(opts.outJson), { recursive: true });
  await fs.promises.writeFile(opts.outJson, JSON.stringify(report, null, 2), 'utf8');
  await fs.promises.writeFile(opts.outMd, buildMarkdown(report), 'utf8');

  // eslint-disable-next-line no-console
  console.log(`Aggregate JSON: ${opts.outJson}`);
  // eslint-disable-next-line no-console
  console.log(`Aggregate MD:   ${opts.outMd}`);
}

if (require.main === module) {
  main().catch(err => {
    // eslint-disable-next-line no-console
    console.error('botEvalStabilityAggregate failed:', err);
    process.exit(1);
  });
}

