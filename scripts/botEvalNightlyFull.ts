import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

type FullOptions = {
  runs: number;
  gateConfig: string;
  window: number;
  root: string;
  continueOnInfraFailure: boolean;
  infraRecoveryTimeoutSec: number;
  infraRecoveryPollSec: number;
  autoRestartOnInfraFailure: boolean;
  maxInfraRestarts: number;
  extraArgs: string[];
};

type NightlyStepRunner = (label: string, args: string[], cwd: string) => Promise<number>;

type NightlyFullDeps = {
  repoRoot?: string;
  runStep?: NightlyStepRunner;
  log?: (message: string) => void;
  error?: (message: string) => void;
  setExitCode?: (code: number) => void;
};

export function parseNightlyFullArgs(argv: string[]): FullOptions {
  const opts: FullOptions = {
    runs: 5,
    gateConfig: path.resolve('scripts/config/botEvalGate.nightly.json'),
    window: 10,
    root: path.resolve('projects/bot_eval_run'),
    continueOnInfraFailure: true,
    infraRecoveryTimeoutSec: 90,
    infraRecoveryPollSec: 5,
    autoRestartOnInfraFailure: true,
    maxInfraRestarts: 2,
    extraArgs: []
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[i + 1];
    if (a === '--runs' && next()) { opts.runs = Number(next()); i++; continue; }
    if (a === '--gateConfig' && next()) { opts.gateConfig = path.resolve(next()); i++; continue; }
    if (a === '--window' && next()) { opts.window = Number(next()); i++; continue; }
    if (a === '--root' && next()) { opts.root = path.resolve(next()); i++; continue; }
    if (a === '--help' || a === '-h') { printUsageAndExit(0); }
    opts.extraArgs.push(a);
  }
  return opts;
}

function printUsageAndExit(code: number): never {
  console.log([
    'Usage: npm run bot:eval:nightly:full -- [options]',
    '',
    'Chains: release-gate → checkpoint → calibrate → promote → tuner → stability → repair-canary → cleanup',
    '',
    'Options:',
    '  --runs <n>           Release gate runs per scenario (default: 5)',
    '  --gateConfig <path>  Gate config JSON (default: scripts/config/botEvalGate.nightly.json)',
    '  --window <n>         Rolling window for checkpoint/calibrate (default: 10)',
    '  --root <dir>         Bot eval run root (default: projects/bot_eval_run)',
    '  -h, --help           Show this help',
  ].join('\n'));
  process.exit(code);
}

function runStep(label: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(60)}\n[${label}] ${args.join(' ')}\n${'='.repeat(60)}\n`);
    const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

export async function runNightlyFull(opts: FullOptions, deps: NightlyFullDeps = {}): Promise<{
  gateCode: number;
  checkpointCode: number;
  calibrateCode: number;
  promoteCode: number;
  tunerCode: number;
  stabilityCode: number;
  repairCanaryCode: number;
  cleanupCode: number;
  latestGateDir: string;
  promoteReportPath: string;
  releaseGateDirs: string[];
}> {
  const repoRoot = deps.repoRoot || path.resolve(__dirname, '..');
  const executeStep = deps.runStep || runStep;
  const log = deps.log || ((message: string) => console.log(message));
  const error = deps.error || ((message: string) => console.error(message));
  const setExitCode = deps.setExitCode || ((code: number) => { process.exitCode = code; });
  const tsNode = path.join(repoRoot, 'node_modules', 'ts-node', 'dist', 'bin.js');
  if (!fs.existsSync(tsNode)) {
    throw new Error(`ts-node not found at ${tsNode}`);
  }

  // Step 1: Release gate (batch + compare)
  const gateArgs = [
    tsNode,
    path.join(repoRoot, 'scripts', 'botEvalReleaseGate.ts'),
    '--gateConfig', opts.gateConfig,
    '--runs', String(opts.runs),
    '--continueOnInfraFailure',
    '--infraRecoveryTimeoutSec', String(opts.infraRecoveryTimeoutSec),
    '--infraRecoveryPollSec', String(opts.infraRecoveryPollSec),
    '--autoRestartOnInfraFailure', String(opts.autoRestartOnInfraFailure),
    '--maxInfraRestarts', String(opts.maxInfraRestarts),
    ...opts.extraArgs
  ];
  const gateCode = await executeStep('Release Gate', gateArgs, repoRoot);
  if (gateCode !== 0) {
    error(`Release gate failed with code ${gateCode}`);
    setExitCode(gateCode);
    return {
      gateCode,
      checkpointCode: 1,
      calibrateCode: 1,
      promoteCode: 0,
      tunerCode: 1,
      stabilityCode: 0,
      repairCanaryCode: 0,
      cleanupCode: 0,
      latestGateDir: '',
      promoteReportPath: '',
      releaseGateDirs: []
    };
  }

  // Step 2: Checkpoint
  const checkpointArgs = [
    tsNode,
    path.join(repoRoot, 'scripts', 'botEvalCheckpointManager.ts'),
    '--window', String(opts.window),
    '--root', opts.root
  ];
  const checkpointCode = await executeStep('Checkpoint', checkpointArgs, repoRoot);
  if (checkpointCode !== 0) {
    error(`Checkpoint failed with code ${checkpointCode}`);
  }

  // Step 3: Calibrate (with --includeLocalRuns for local dev)
  const calibrateArgs = [
    tsNode,
    path.join(repoRoot, 'scripts', 'botEvalNightlyCalibrate.ts'),
    '--window', String(opts.window),
    '--root', opts.root,
    '--includeLocalRuns'
  ];
  const calibrateCode = await executeStep('Calibrate', calibrateArgs, repoRoot);
  if (calibrateCode !== 0) {
    error(`Calibrate failed with code ${calibrateCode}`);
  }

  // Step 4: Baseline promotion (runs BEFORE tuner so tuner sees current promotion state)
  const latestGateDirs = fs.readdirSync(opts.root, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^release_gate_\d+$/.test(d.name))
    .map(d => path.join(opts.root, d.name))
    .sort();
  const latestGateDir = latestGateDirs.length > 0 ? latestGateDirs[latestGateDirs.length - 1] : '';
  let promoteCode = 0;
  let promoteReportPath = '';
  if (latestGateDir && fs.existsSync(path.join(latestGateDir, 'summary.json'))) {
    const promoteStatePath = path.join(opts.root, 'baseline_promotion_state.json');
    const promoteStableDir = path.join(opts.root, 'release_gate_stable_nightly');
    const promoteArgs = [
      tsNode,
      path.join(repoRoot, 'scripts', 'botEvalBaselinePromote.ts'),
      '--candidate', latestGateDir,
      '--stable', promoteStableDir,
      '--state', promoteStatePath,
      '--scenario', 'ts-todo-oracle',
      '--requiredConsecutive', '2',
      '--maxPlannerErrorRate', '0.15'
    ];
    promoteCode = await executeStep('Baseline Promote', promoteArgs, repoRoot);
    if (promoteCode !== 0) {
      error(`Baseline promote failed with code ${promoteCode}`);
    }
    // Auto-update baseline pointer on successful promotion
    promoteReportPath = path.join(latestGateDir, 'baseline_promotion.json');
    if (promoteCode === 0 && fs.existsSync(promoteReportPath)) {
      try {
        const report = JSON.parse(fs.readFileSync(promoteReportPath, 'utf8'));
        if (report.promoted) {
          const baselinePointerPath = path.join(opts.root, 'release_baseline.txt');
          fs.writeFileSync(baselinePointerPath, promoteStableDir + '\n', 'utf8');
          log(`Baseline pointer updated to ${promoteStableDir}`);
        }
      } catch { /* ignore parse errors */ }
    }
  } else {
    log('\nSkipping baseline promotion (no recent gate with summary.json)');
  }

  // Step 5: Tuner (receives --baselinePromotion from Step 4)
  const calibrationPath = path.join(opts.root, 'calibration_recommendation_latest.json');
  const registryPath = path.join(opts.root, 'checkpoint_registry.json');
  const statePath = path.join(opts.root, 'tuner_state.json');
  const tunerArgs = [
    tsNode,
    path.join(repoRoot, 'scripts', 'botEvalTuner.ts'),
    '--config', path.join(repoRoot, 'scripts', 'config', 'botEvalTuner.nightly.json'),
    '--checkpointReport', path.join(opts.root, 'checkpoint_report_latest.json'),
    '--calibration', calibrationPath,
    '--registry', registryPath,
    '--state', statePath,
    '--applyDecision'
  ];
  if (promoteReportPath && fs.existsSync(promoteReportPath)) {
    tunerArgs.push('--baselinePromotion', promoteReportPath);
  }
  const tunerCode = await executeStep('Tuner', tunerArgs, repoRoot);
  if (tunerCode !== 0) {
    error(`Tuner failed with code ${tunerCode}`);
  }

  // Step 6: Stability aggregate (local trending)
  const releaseGateDirs = fs.readdirSync(opts.root, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^release_gate_\d+$/.test(d.name))
    .map(d => path.join(opts.root, d.name))
    .sort()
    .slice(-3);

  let stabilityCode = 0;
  if (releaseGateDirs.length >= 2) {
    const stabilityArgs = [
      tsNode,
      path.join(repoRoot, 'scripts', 'botEvalStabilityAggregate.ts'),
      '--inputs', releaseGateDirs.join(',')
    ];
    stabilityCode = await executeStep('Stability Aggregate', stabilityArgs, repoRoot);
  } else {
    log(`\nSkipping stability aggregate (need ≥2 release_gate dirs, found ${releaseGateDirs.length})`);
  }

  // Step 7: Non-blocking repair canary batch
  const repairCanaryDir = path.join(opts.root, 'repair_nightly_canary_latest');
  const repairCanaryArgs = [
    tsNode,
    path.join(repoRoot, 'scripts', 'botEvalBatch.ts'),
    '--runs', '3',
    '--scenarios', 'ts-csv-repair-oracle,node-api-repair-oracle',
    '--model', 'qwen2.5-coder:14b',
    '--plannerModel', 'deepseek-r1:8b',
    '--reviewerModel', 'qwen2.5:3b',
    '--jsonRepairModel', 'qwen2.5:7b',
    '--maxIterations', '6',
    '--timeoutSec', '1200',
    '--hardTimeoutSec', '1200',
    '--outDir', repairCanaryDir
  ];
  const repairCanaryCode = await executeStep('Repair Canary', repairCanaryArgs, repoRoot);
  if (repairCanaryCode !== 0) {
    error(`Repair canary failed with code ${repairCanaryCode} (non-blocking)`);
  }

  // Step 8: Cleanup old run/batch dirs (keep last 10 per prefix)
  const cleanupArgs = [
    tsNode,
    path.join(repoRoot, 'scripts', 'botEvalCleanup.ts'),
    '--root', opts.root,
    '--policy', 'run_:5',
    '--policy', 'batch_:5',
    '--policy', 'release_gate_ci_pr_:10',
    '--policy', 'release_gate_ci_nightly_:10'
  ];
  const cleanupCode = await executeStep('Cleanup', cleanupArgs, repoRoot);

  // Summary
  log(`\n${'='.repeat(60)}\n[Summary]\n${'='.repeat(60)}`);
  log(`  Release gate: ${gateCode === 0 ? 'PASS' : 'FAIL'}`);
  log(`  Checkpoint:   ${checkpointCode === 0 ? 'PASS' : 'FAIL'}`);
  log(`  Calibrate:    ${calibrateCode === 0 ? 'PASS' : 'FAIL'}`);
  log(`  Promote:      ${latestGateDir ? (promoteCode === 0 ? 'PASS' : 'FAIL') : 'SKIP'}`);
  log(`  Tuner:        ${tunerCode === 0 ? 'PASS' : 'FAIL'}`);

  if (fs.existsSync(path.join(opts.root, 'tuning_decision_latest.json'))) {
    try {
      const decision = JSON.parse(fs.readFileSync(path.join(opts.root, 'tuning_decision_latest.json'), 'utf8'));
      log(`  Tuner action: ${decision.action} (checkpoint: ${decision.latestCheckpointId || 'n/a'})`);
    } catch { /* ignore */ }
  }

  log(`  Stability:    ${releaseGateDirs.length >= 2 ? (stabilityCode === 0 ? 'PASS' : 'FAIL') : 'SKIP'}`);
  log(`  Repair canary:${repairCanaryCode === 0 ? ' PASS' : ' FAIL (non-blocking)'}`);
  log(`  Cleanup:      ${cleanupCode === 0 ? 'PASS' : 'FAIL'}`);
  log('');

  return {
    gateCode,
    checkpointCode,
    calibrateCode,
    promoteCode,
    tunerCode,
    stabilityCode,
    repairCanaryCode,
    cleanupCode,
    latestGateDir,
    promoteReportPath,
    releaseGateDirs
  };
}

async function main() {
  const opts = parseNightlyFullArgs(process.argv.slice(2));
  await runNightlyFull(opts);
}

if (require.main === module) {
  main().catch(err => {
    console.error('botEvalNightlyFull failed:', err);
    process.exit(1);
  });
}
