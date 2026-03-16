import * as fs from 'fs';
import * as path from 'path';

import { updateCheckpointRegistry } from './botEvalCheckpointManager';

type TunerPolicy = {
  version: number;
  requireCheckpointQualification: boolean;
  requireCalibrationReadiness: boolean;
  rollbackOnCheckpointFailure: boolean;
  holdWhenPromotionPending: boolean;
  notes?: string;
};

type TunerOptions = {
  checkpointReportPath: string;
  calibrationPath?: string;
  baselinePromotionPath?: string;
  registryPath: string;
  statePath: string;
  outJson: string;
  outMd: string;
  configPath?: string;
  applyDecision: boolean;
};

type CheckpointReport = {
  generatedAt: string;
  manifestVersion: number;
  manifestPath: string;
  rootDir: string;
  window: number;
  inputs: string[];
  baselineDir: string;
  checkpoint: {
    qualified: boolean;
    reasons: string[];
    latestRunDir?: string;
    baselineDir?: string;
    latestQualifiedScenarioIds: string[];
  };
};

type CalibrationRecommendation = {
  readiness?: {
    ready_to_tighten_pr?: boolean;
    reason_if_not_ready?: string;
    last3NightlyRunIds?: string[];
  };
};

type BaselinePromotionReport = {
  qualified?: boolean;
  promoted?: boolean;
  promotionMessage?: string;
  streakAfter?: number;
  requiredConsecutive?: number;
};

type CheckpointRegistry = {
  activeCheckpointId?: string;
  entries?: Array<{ id: string; qualified: boolean; runDir: string }>;
};

type TuningAction = 'accept' | 'hold' | 'rollback';

type TuningDecision = {
  generatedAt: string;
  action: TuningAction;
  rationale: string[];
  latestCheckpointId: string;
  activeCheckpointId: string;
  targetCheckpointId: string;
  checkpointQualified: boolean;
  calibrationReady: boolean;
  calibrationReason: string;
  baselinePromotionQualified: boolean;
  baselinePromoted: boolean;
  baselinePromotionMessage: string;
};

type TunerState = {
  version: 1;
  updatedAt: string;
  lastDecision?: TuningDecision;
  acceptedCheckpointId?: string;
  history: TuningDecision[];
};

function parseArgs(argv: string[]): TunerOptions {
  const opts: TunerOptions = {
    checkpointReportPath: path.resolve('projects/bot_eval_run/checkpoint_report_latest.json'),
    calibrationPath: path.resolve('projects/bot_eval_run/calibration_recommendation_latest.json'),
    baselinePromotionPath: path.resolve('projects/bot_eval_run/baseline_promotion.json'),
    registryPath: path.resolve('projects/bot_eval_run/checkpoint_registry.json'),
    statePath: path.resolve('projects/bot_eval_run/tuner_state.json'),
    outJson: path.resolve('projects/bot_eval_run/tuning_decision_latest.json'),
    outMd: path.resolve('projects/bot_eval_run/tuning_decision_latest.md'),
    configPath: path.resolve('scripts/config/botEvalTuner.nightly.json'),
    applyDecision: false
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => argv[index + 1];
    if (arg === '--checkpointReport' && next()) {
      opts.checkpointReportPath = path.resolve(next());
      index++;
      continue;
    }
    if (arg === '--calibration' && next()) {
      opts.calibrationPath = path.resolve(next());
      index++;
      continue;
    }
    if (arg === '--baselinePromotion' && next()) {
      opts.baselinePromotionPath = path.resolve(next());
      index++;
      continue;
    }
    if (arg === '--registry' && next()) {
      opts.registryPath = path.resolve(next());
      index++;
      continue;
    }
    if (arg === '--state' && next()) {
      opts.statePath = path.resolve(next());
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
    if (arg === '--config' && next()) {
      opts.configPath = path.resolve(next());
      index++;
      continue;
    }
    if (arg === '--applyDecision') {
      opts.applyDecision = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsageAndExit(0);
    }
  }

  return opts;
}

function printUsageAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.log([
    'Usage: npm run bot:eval:tuner -- [options]',
    '',
    'Options:',
    '  --checkpointReport <path>   Checkpoint report JSON',
    '  --calibration <path>        Calibration recommendation JSON',
    '  --baselinePromotion <path>  Baseline promotion JSON',
    '  --registry <path>           Checkpoint registry JSON',
    '  --state <path>              Tuner state JSON',
    '  --out <path>                Output decision JSON',
    '  --outMd <path>              Output decision markdown',
    '  --config <path>             Tuner policy JSON',
    '  --applyDecision             Persist state and registry update',
    '  -h, --help                  Show this help'
  ].join('\n'));
  process.exit(code);
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function loadOptionalJsonFile<T>(filePath?: string): T | undefined {
  if (!filePath) return undefined;
  if (!fs.existsSync(filePath)) return undefined;
  return readJsonFile<T>(filePath);
}

function loadPolicy(configPath?: string): TunerPolicy {
  if (!configPath || !fs.existsSync(configPath)) {
    return {
      version: 1,
      requireCheckpointQualification: true,
      requireCalibrationReadiness: true,
      rollbackOnCheckpointFailure: true,
      holdWhenPromotionPending: false
    };
  }
  const raw = readJsonFile<any>(configPath);
  return {
    version: Math.max(1, Number(raw?.version) || 1),
    requireCheckpointQualification: raw?.requireCheckpointQualification !== false,
    requireCalibrationReadiness: raw?.requireCalibrationReadiness !== false,
    rollbackOnCheckpointFailure: raw?.rollbackOnCheckpointFailure !== false,
    holdWhenPromotionPending: raw?.holdWhenPromotionPending === true,
    notes: String(raw?.notes || '').trim() || undefined
  };
}

function getCheckpointId(report: CheckpointReport): string {
  const latestRunDir = String(report?.checkpoint?.latestRunDir || '').trim();
  const runName = latestRunDir ? path.win32.basename(latestRunDir) : 'unknown-run';
  return `${runName}@manifest-v${Math.max(1, Number(report?.manifestVersion) || 1)}`;
}

function loadRegistry(registryPath: string): CheckpointRegistry {
  if (!fs.existsSync(registryPath)) return {};
  return readJsonFile<CheckpointRegistry>(registryPath);
}

export function buildTuningDecision(params: {
  checkpointReport: CheckpointReport;
  calibration?: CalibrationRecommendation;
  baselinePromotion?: BaselinePromotionReport;
  registry?: CheckpointRegistry;
  policy: TunerPolicy;
}): TuningDecision {
  const checkpointQualified = Boolean(params.checkpointReport?.checkpoint?.qualified);
  const calibrationReady = Boolean(params.calibration?.readiness?.ready_to_tighten_pr);
  const calibrationReason = String(params.calibration?.readiness?.reason_if_not_ready || '').trim();
  const baselinePromotionQualified = Boolean(params.baselinePromotion?.qualified);
  const baselinePromoted = Boolean(params.baselinePromotion?.promoted);
  const baselinePromotionMessage = String(params.baselinePromotion?.promotionMessage || '').trim();
  const latestCheckpointId = getCheckpointId(params.checkpointReport);
  const activeCheckpointId = String(params.registry?.activeCheckpointId || '').trim();
  const rationale: string[] = [];

  if (params.policy.requireCheckpointQualification && !checkpointQualified) {
    rationale.push(...(params.checkpointReport?.checkpoint?.reasons || []));
  }
  if (params.policy.requireCalibrationReadiness && !calibrationReady) {
    rationale.push(calibrationReason || 'Calibration readiness is false.');
  }
  if (params.policy.holdWhenPromotionPending && baselinePromotionQualified && !baselinePromoted) {
    rationale.push(baselinePromotionMessage || 'Baseline promotion is still pending.');
  }

  let action: TuningAction = 'hold';
  let targetCheckpointId = activeCheckpointId || latestCheckpointId;

  if (params.policy.requireCheckpointQualification && !checkpointQualified) {
    if (params.policy.rollbackOnCheckpointFailure && activeCheckpointId && activeCheckpointId !== latestCheckpointId) {
      action = 'rollback';
      targetCheckpointId = activeCheckpointId;
      rationale.unshift(`Latest checkpoint ${latestCheckpointId} failed qualification; keep active checkpoint ${activeCheckpointId}.`);
    } else {
      action = 'hold';
      targetCheckpointId = activeCheckpointId || latestCheckpointId;
      rationale.unshift(`Latest checkpoint ${latestCheckpointId} failed qualification and no prior active checkpoint is available for rollback.`);
    }
  } else if (params.policy.requireCalibrationReadiness && !calibrationReady) {
    action = 'hold';
    targetCheckpointId = activeCheckpointId || latestCheckpointId;
    rationale.unshift(`Checkpoint ${latestCheckpointId} is qualified, but calibration readiness is not yet green.`);
  } else if (params.policy.holdWhenPromotionPending && baselinePromotionQualified && !baselinePromoted) {
    action = 'hold';
    targetCheckpointId = activeCheckpointId || latestCheckpointId;
    rationale.unshift(`Checkpoint ${latestCheckpointId} is qualified, but baseline promotion streak is still pending.`);
  } else {
    action = 'accept';
    targetCheckpointId = latestCheckpointId;
    rationale.unshift(`Checkpoint ${latestCheckpointId} satisfies the current tuning policy.`);
  }

  return {
    generatedAt: new Date().toISOString(),
    action,
    rationale,
    latestCheckpointId,
    activeCheckpointId,
    targetCheckpointId,
    checkpointQualified,
    calibrationReady,
    calibrationReason,
    baselinePromotionQualified,
    baselinePromoted,
    baselinePromotionMessage
  };
}

export function updateTunerState(statePath: string, decision: TuningDecision): TunerState {
  const existing: TunerState = fs.existsSync(statePath)
    ? readJsonFile<TunerState>(statePath)
    : { version: 1, updatedAt: decision.generatedAt, history: [] };
  const acceptedCheckpointId = decision.action === 'accept'
    ? decision.targetCheckpointId
    : existing.acceptedCheckpointId;
  const updated: TunerState = {
    version: 1,
    updatedAt: decision.generatedAt,
    lastDecision: decision,
    acceptedCheckpointId,
    history: [decision, ...(Array.isArray(existing.history) ? existing.history : [])].slice(0, 100)
  };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

function buildMarkdown(decision: TuningDecision): string {
  const lines: string[] = [];
  lines.push('# BotEval Tuning Decision');
  lines.push('');
  lines.push(`Generated: ${decision.generatedAt}`);
  lines.push(`Action: ${decision.action}`);
  lines.push(`Latest checkpoint: ${decision.latestCheckpointId}`);
  lines.push(`Active checkpoint: ${decision.activeCheckpointId || 'n/a'}`);
  lines.push(`Target checkpoint: ${decision.targetCheckpointId || 'n/a'}`);
  lines.push(`Checkpoint qualified: ${decision.checkpointQualified}`);
  lines.push(`Calibration ready: ${decision.calibrationReady}`);
  lines.push(`Baseline promoted: ${decision.baselinePromoted}`);
  lines.push('');
  lines.push('## Rationale');
  for (const reason of decision.rationale) {
    lines.push(`- ${reason}`);
  }
  lines.push('');
  return lines.join('\n');
}

export async function runTuner(opts: TunerOptions): Promise<TuningDecision> {
  if (!fs.existsSync(opts.checkpointReportPath)) {
    throw new Error(`Missing checkpoint report: ${opts.checkpointReportPath}`);
  }
  const checkpointReport = readJsonFile<CheckpointReport>(opts.checkpointReportPath);
  const calibration = loadOptionalJsonFile<CalibrationRecommendation>(opts.calibrationPath);
  const baselinePromotion = loadOptionalJsonFile<BaselinePromotionReport>(opts.baselinePromotionPath);
  const registry = loadRegistry(opts.registryPath);
  const policy = loadPolicy(opts.configPath);

  const decision = buildTuningDecision({
    checkpointReport,
    calibration,
    baselinePromotion,
    registry,
    policy
  });

  await fs.promises.mkdir(path.dirname(opts.outJson), { recursive: true });
  await fs.promises.writeFile(opts.outJson, JSON.stringify(decision, null, 2), 'utf8');
  await fs.promises.writeFile(opts.outMd, buildMarkdown(decision), 'utf8');

  if (opts.applyDecision) {
    updateCheckpointRegistry(opts.registryPath, checkpointReport as any, decision.action === 'accept');
    updateTunerState(opts.statePath, decision);
  }

  return decision;
}

if (require.main === module) {
  runTuner(parseArgs(process.argv.slice(2))).then(decision => {
    // eslint-disable-next-line no-console
    console.log(`Tuning decision: ${decision.action}`);
    // eslint-disable-next-line no-console
    console.log(`Target checkpoint: ${decision.targetCheckpointId || 'n/a'}`);
  }).catch((error: any) => {
    // eslint-disable-next-line no-console
    console.error(error?.stack || String(error));
    process.exit(1);
  });
}
