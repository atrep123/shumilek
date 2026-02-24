import * as fs from 'fs';
import * as path from 'path';

type SummaryScenario = {
  scenario: string;
  passRate: number;
  rawRunPassRate: number;
  fallbackDependencyRunRate: number;
  runsWithPlannerError: number;
  runsWithJsonRepairError: number;
  runsWithSchemaFailure: number;
  runsWithJsonParseFailure: number;
  runsWithPlaceholderFailure: number;
  runsWithOtherParseFailure: number;
};

type PromotionState = {
  version: number;
  requiredConsecutive: number;
  streak: number;
  lastCandidateDir?: string;
  lastQualifiedAt?: string;
  lastPromotion?: {
    at: string;
    candidateDir: string;
    stableDir: string;
  };
  history: Array<{
    at: string;
    candidateDir: string;
    qualified: boolean;
    promoted: boolean;
    streakAfter: number;
    reason: string;
  }>;
};

type PromoteOptions = {
  candidateDir: string;
  stableDir: string;
  statePath: string;
  outPath: string;
  scenario: string;
  requiredConsecutive: number;
  minRawRunPassRate: number;
  maxFallbackDependencyRunRate: number;
};

function parseArgs(argv: string[]): PromoteOptions {
  const opts: PromoteOptions = {
    candidateDir: '',
    stableDir: '',
    statePath: 'C:\\actions-runner\\release_gate_promotion_state.json',
    outPath: '',
    scenario: 'ts-todo-oracle',
    requiredConsecutive: 2,
    minRawRunPassRate: 1,
    maxFallbackDependencyRunRate: 0,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[i + 1];
    if (a === '--candidate' && next()) {
      opts.candidateDir = path.resolve(next());
      i++;
      continue;
    }
    if (a === '--stable' && next()) {
      opts.stableDir = path.resolve(next());
      i++;
      continue;
    }
    if (a === '--state' && next()) {
      opts.statePath = path.resolve(next());
      i++;
      continue;
    }
    if (a === '--out' && next()) {
      opts.outPath = path.resolve(next());
      i++;
      continue;
    }
    if (a === '--scenario' && next()) {
      opts.scenario = String(next()).trim() || opts.scenario;
      i++;
      continue;
    }
    if (a === '--requiredConsecutive' && next()) {
      opts.requiredConsecutive = Number(next());
      i++;
      continue;
    }
    if (a === '--minRawRunPassRate' && next()) {
      opts.minRawRunPassRate = Number(next());
      i++;
      continue;
    }
    if (a === '--maxFallbackDependencyRunRate' && next()) {
      opts.maxFallbackDependencyRunRate = Number(next());
      i++;
      continue;
    }
    if (a === '--help' || a === '-h') {
      printUsageAndExit(0);
    }
  }

  if (!opts.candidateDir) throw new Error('Missing --candidate <dir>');
  if (!opts.stableDir) throw new Error('Missing --stable <dir>');
  if (!Number.isFinite(opts.requiredConsecutive) || opts.requiredConsecutive <= 0) {
    opts.requiredConsecutive = 2;
  }
  if (!Number.isFinite(opts.minRawRunPassRate)) opts.minRawRunPassRate = 1;
  if (!Number.isFinite(opts.maxFallbackDependencyRunRate)) opts.maxFallbackDependencyRunRate = 0;
  if (!opts.outPath) opts.outPath = path.join(opts.candidateDir, 'baseline_promotion.json');
  return opts;
}

function printUsageAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.log([
    'Usage: npm run bot:eval:baseline:promote -- --candidate <dir> --stable <dir> [options]',
    '',
    'Options:',
    '  --candidate <dir>                    Candidate release-gate output directory',
    '  --stable <dir>                       Stable baseline directory to replace on promotion',
    '  --state <path>                       Promotion state file path',
    '  --out <path>                         Promotion report output path',
    '  --scenario <id>                      Scenario used for guard checks (default: ts-todo-oracle)',
    '  --requiredConsecutive <n>            Required consecutive qualifying runs (default: 2)',
    '  --minRawRunPassRate <n>              Minimum rawRunPassRate for scenario (default: 1)',
    '  --maxFallbackDependencyRunRate <n>   Maximum fallbackDependencyRunRate for scenario (default: 0)',
    '  -h, --help                           Show this help',
  ].join('\n'));
  process.exit(code);
}

function readJson<T>(p: string): T {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw) as T;
}

function loadState(statePath: string, requiredConsecutive: number): PromotionState {
  if (!fs.existsSync(statePath)) {
    return {
      version: 1,
      requiredConsecutive,
      streak: 0,
      history: []
    };
  }
  try {
    const loaded = readJson<PromotionState>(statePath);
    return {
      version: 1,
      requiredConsecutive,
      streak: Number(loaded?.streak) || 0,
      lastCandidateDir: loaded?.lastCandidateDir,
      lastQualifiedAt: loaded?.lastQualifiedAt,
      lastPromotion: loaded?.lastPromotion,
      history: Array.isArray(loaded?.history) ? loaded.history.slice(-50) : []
    };
  } catch {
    return {
      version: 1,
      requiredConsecutive,
      streak: 0,
      history: []
    };
  }
}

function evaluateQualification(opts: PromoteOptions, summary: SummaryScenario[]): { ok: boolean; reason: string } {
  if (!Array.isArray(summary) || summary.length === 0) {
    return { ok: false, reason: 'summary.json is empty' };
  }
  const ts = summary.find(r => r.scenario === opts.scenario);
  if (!ts) return { ok: false, reason: `scenario ${opts.scenario} missing in summary` };

  const issues: string[] = [];
  if ((Number(ts.passRate) || 0) < 1) issues.push(`${opts.scenario} passRate < 1`);
  if ((Number(ts.rawRunPassRate) || 0) < opts.minRawRunPassRate) {
    issues.push(`${opts.scenario} rawRunPassRate ${(Number(ts.rawRunPassRate) || 0).toFixed(4)} < ${opts.minRawRunPassRate}`);
  }
  if ((Number(ts.fallbackDependencyRunRate) || 0) > opts.maxFallbackDependencyRunRate) {
    issues.push(
      `${opts.scenario} fallbackDependencyRunRate ${(Number(ts.fallbackDependencyRunRate) || 0).toFixed(4)} > ${opts.maxFallbackDependencyRunRate}`
    );
  }

  for (const row of summary) {
    if ((Number(row.passRate) || 0) < 1) issues.push(`${row.scenario} passRate < 1`);
    if ((Number(row.runsWithPlannerError) || 0) > 0) issues.push(`${row.scenario} has planner errors`);
    if ((Number(row.runsWithJsonRepairError) || 0) > 0) issues.push(`${row.scenario} has json repair errors`);
    if ((Number(row.runsWithSchemaFailure) || 0) > 0) issues.push(`${row.scenario} has schema failures`);
    if ((Number(row.runsWithJsonParseFailure) || 0) > 0) issues.push(`${row.scenario} has json parse failures`);
    if ((Number(row.runsWithPlaceholderFailure) || 0) > 0) issues.push(`${row.scenario} has placeholder failures`);
    if ((Number(row.runsWithOtherParseFailure) || 0) > 0) issues.push(`${row.scenario} has other parse failures`);
  }

  if (issues.length > 0) {
    return { ok: false, reason: issues.join(' | ') };
  }
  return { ok: true, reason: 'qualified' };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const summaryPath = path.join(opts.candidateDir, 'summary.json');
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`Missing summary.json in candidate dir: ${summaryPath}`);
  }

  const summary = readJson<SummaryScenario[]>(summaryPath);
  const state = loadState(opts.statePath, opts.requiredConsecutive);
  const before = Number(state.streak) || 0;
  const nowIso = new Date().toISOString();
  const qualification = evaluateQualification(opts, summary);
  const after = qualification.ok ? before + 1 : 0;
  state.streak = after;
  state.requiredConsecutive = opts.requiredConsecutive;
  state.lastCandidateDir = opts.candidateDir;
  if (qualification.ok) state.lastQualifiedAt = nowIso;

  let promoted = false;
  let promotionMessage = 'not promoted';
  const sameDir = path.resolve(opts.candidateDir).toLowerCase() === path.resolve(opts.stableDir).toLowerCase();
  if (qualification.ok && after >= opts.requiredConsecutive && !sameDir) {
    await fs.promises.mkdir(path.dirname(opts.stableDir), { recursive: true });
    await fs.promises.rm(opts.stableDir, { recursive: true, force: true });
    await fs.promises.cp(opts.candidateDir, opts.stableDir, { recursive: true, force: true });
    const stableResults = path.join(opts.stableDir, 'results.json');
    if (!fs.existsSync(stableResults)) {
      throw new Error(`Promotion copy incomplete, missing results.json at ${stableResults}`);
    }
    promoted = true;
    promotionMessage = `promoted after streak ${after}/${opts.requiredConsecutive}`;
    state.lastPromotion = {
      at: nowIso,
      candidateDir: opts.candidateDir,
      stableDir: opts.stableDir
    };
  } else if (sameDir) {
    promotionMessage = 'candidateDir equals stableDir, skip copy';
  } else if (!qualification.ok) {
    promotionMessage = `not qualified: ${qualification.reason}`;
  } else {
    promotionMessage = `qualified but streak ${after}/${opts.requiredConsecutive} is below threshold`;
  }

  state.history.push({
    at: nowIso,
    candidateDir: opts.candidateDir,
    qualified: qualification.ok,
    promoted,
    streakAfter: after,
    reason: promotionMessage
  });
  state.history = state.history.slice(-100);

  await fs.promises.mkdir(path.dirname(opts.statePath), { recursive: true });
  await fs.promises.writeFile(opts.statePath, JSON.stringify(state, null, 2), 'utf8');

  const report = {
    generatedAt: nowIso,
    candidateDir: opts.candidateDir,
    stableDir: opts.stableDir,
    statePath: opts.statePath,
    requiredConsecutive: opts.requiredConsecutive,
    streakBefore: before,
    streakAfter: after,
    qualified: qualification.ok,
    qualificationReason: qualification.reason,
    promoted,
    promotionMessage,
    lastPromotion: state.lastPromotion || null
  };

  await fs.promises.mkdir(path.dirname(opts.outPath), { recursive: true });
  await fs.promises.writeFile(opts.outPath, JSON.stringify(report, null, 2), 'utf8');

  // eslint-disable-next-line no-console
  console.log(`Baseline promotion report: ${opts.outPath}`);
  // eslint-disable-next-line no-console
  console.log(`Promotion decision: ${promotionMessage}`);
}

if (require.main === module) {
  main().catch(err => {
    // eslint-disable-next-line no-console
    console.error('botEvalBaselinePromote failed:', err);
    process.exit(1);
  });
}

