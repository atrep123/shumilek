import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  parseNightlyFullArgs,
  runNightlyFull
} from '../scripts/botEvalNightlyFull';

function writeJson(filePath: string, value: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function createRepoRoot(tmp: string): string {
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(repoRoot, 'node_modules', 'ts-node', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'node_modules', 'ts-node', 'dist', 'bin.js'), '', 'utf8');
  return repoRoot;
}

function createReleaseGateDir(root: string, name: string, withSummary = true): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  if (withSummary) {
    writeJson(path.join(dir, 'summary.json'), [{ scenario: 'ts-todo-oracle', passRate: 1 }]);
  }
  return dir;
}

describe('botEvalNightlyFull', () => {
  it('parses nightly full args and keeps unknown args for release gate passthrough', () => {
    const opts = parseNightlyFullArgs(['--runs', '7', '--window', '12', '--foo', 'bar']);
    assert.equal(opts.runs, 7);
    assert.equal(opts.window, 12);
    assert.deepEqual(opts.extraArgs, ['--foo', 'bar']);
  });

  it('passes promotion report to tuner, updates baseline pointer to stable nightly, and limits stability inputs to latest three release gates', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-nightly-full-'));
    try {
      const repoRoot = createRepoRoot(tmp);
      const runRoot = path.join(tmp, 'runs');
      fs.mkdirSync(runRoot, { recursive: true });
      createReleaseGateDir(runRoot, 'release_gate_1001');
      createReleaseGateDir(runRoot, 'release_gate_1002');
      createReleaseGateDir(runRoot, 'release_gate_1003');
      const latestGateDir = createReleaseGateDir(runRoot, 'release_gate_1004');
      writeJson(path.join(latestGateDir, 'baseline_promotion.json'), { promoted: true });
      writeJson(path.join(runRoot, 'tuning_decision_latest.json'), {
        action: 'accept',
        latestCheckpointId: 'release_gate_1004@manifest-v1'
      });

      const steps: Array<{ label: string; args: string[]; cwd: string }> = [];
      const logs: string[] = [];
      const result = await runNightlyFull({
        runs: 5,
        gateConfig: path.join(repoRoot, 'scripts', 'config', 'botEvalGate.nightly.json'),
        window: 10,
        root: runRoot,
        continueOnInfraFailure: true,
        infraRecoveryTimeoutSec: 90,
        infraRecoveryPollSec: 5,
        autoRestartOnInfraFailure: true,
        maxInfraRestarts: 2,
        extraArgs: []
      }, {
        repoRoot,
        runStep: async (label, args, cwd) => {
          steps.push({ label, args, cwd });
          return 0;
        },
        log: (message) => logs.push(message),
        error: (message) => logs.push(`ERR:${message}`)
      });

      assert.equal(result.latestGateDir, latestGateDir);
      assert.deepEqual(steps.map(step => step.label), [
        'Release Gate',
        'Checkpoint',
        'Calibrate',
        'Baseline Promote',
        'Tuner',
        'Stability Aggregate',
        'Repair Canary',
        'Cleanup'
      ]);

      const tunerStep = steps.find(step => step.label === 'Tuner');
      assert.ok(tunerStep);
      assert.ok(tunerStep?.args.includes('--baselinePromotion'));
      assert.ok(tunerStep?.args.includes(path.join(latestGateDir, 'baseline_promotion.json')));
      assert.ok(tunerStep?.args.includes(path.join(repoRoot, 'scripts', 'config', 'botEvalTuner.nightly.json')));

      const stabilityStep = steps.find(step => step.label === 'Stability Aggregate');
      assert.ok(stabilityStep);
      const inputsIndex = stabilityStep?.args.indexOf('--inputs') ?? -1;
      assert.ok(inputsIndex >= 0);
      assert.equal(
        stabilityStep?.args[inputsIndex + 1],
        [
          path.join(runRoot, 'release_gate_1002'),
          path.join(runRoot, 'release_gate_1003'),
          path.join(runRoot, 'release_gate_1004')
        ].join(',')
      );

      const pointerPath = path.join(runRoot, 'release_baseline.txt');
      assert.equal(fs.readFileSync(pointerPath, 'utf8'), path.join(runRoot, 'release_gate_stable_nightly') + '\n');
      assert.ok(logs.some(message => message.includes(`Baseline pointer updated to ${path.join(runRoot, 'release_gate_stable_nightly')}`)));
      assert.ok(logs.some(message => message.includes('Tuner action: accept')));

      const repairCanaryStep = steps.find(step => step.label === 'Repair Canary');
      assert.ok(repairCanaryStep);
      assert.ok(repairCanaryStep?.args.includes('--scenarios'));
      assert.ok(repairCanaryStep?.args.includes('ts-csv-repair-oracle,node-api-repair-oracle'));
      assert.ok(repairCanaryStep?.args.includes('--outDir'));
      assert.ok(repairCanaryStep?.args.includes(path.join(runRoot, 'repair_nightly_canary_latest')));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('skips promotion and stability when no eligible gate directories exist', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-nightly-full-'));
    try {
      const repoRoot = createRepoRoot(tmp);
      const runRoot = path.join(tmp, 'runs');
      fs.mkdirSync(runRoot, { recursive: true });
      createReleaseGateDir(runRoot, 'release_gate_checkpoint_probe_2001');
      createReleaseGateDir(runRoot, 'release_gate_2002', false);

      const steps: Array<{ label: string; args: string[] }> = [];
      const logs: string[] = [];
      await runNightlyFull({
        runs: 5,
        gateConfig: path.join(repoRoot, 'scripts', 'config', 'botEvalGate.nightly.json'),
        window: 10,
        root: runRoot,
        continueOnInfraFailure: true,
        infraRecoveryTimeoutSec: 90,
        infraRecoveryPollSec: 5,
        autoRestartOnInfraFailure: true,
        maxInfraRestarts: 2,
        extraArgs: ['--model', 'test-model']
      }, {
        repoRoot,
        runStep: async (label, args) => {
          steps.push({ label, args });
          return 0;
        },
        log: (message) => logs.push(message),
        error: (message) => logs.push(`ERR:${message}`)
      });

      assert.deepEqual(steps.map(step => step.label), [
        'Release Gate',
        'Checkpoint',
        'Calibrate',
        'Tuner',
        'Repair Canary',
        'Cleanup'
      ]);
      assert.ok(!steps.some(step => step.label === 'Baseline Promote'));
      assert.ok(!steps.some(step => step.label === 'Stability Aggregate'));

      const releaseGateStep = steps.find(step => step.label === 'Release Gate');
      assert.ok(releaseGateStep?.args.includes('--model'));
      assert.ok(releaseGateStep?.args.includes('test-model'));

      const tunerStep = steps.find(step => step.label === 'Tuner');
      assert.ok(tunerStep);
      assert.ok(!tunerStep?.args.includes('--baselinePromotion'));
      assert.ok(logs.some(message => message.includes('Skipping baseline promotion')));
      assert.ok(logs.some(message => message.includes('Skipping stability aggregate')));
      assert.ok(!fs.existsSync(path.join(runRoot, 'release_baseline.txt')));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('keeps repair canary non-blocking when the repair batch fails', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-nightly-full-repair-canary-'));
    try {
      const repoRoot = createRepoRoot(tmp);
      const runRoot = path.join(tmp, 'runs');
      fs.mkdirSync(runRoot, { recursive: true });
      createReleaseGateDir(runRoot, 'release_gate_4001');
      createReleaseGateDir(runRoot, 'release_gate_4002');

      const steps: Array<{ label: string; args: string[] }> = [];
      const logs: string[] = [];
      const result = await runNightlyFull({
        runs: 5,
        gateConfig: path.join(repoRoot, 'scripts', 'config', 'botEvalGate.nightly.json'),
        window: 10,
        root: runRoot,
        continueOnInfraFailure: true,
        infraRecoveryTimeoutSec: 90,
        infraRecoveryPollSec: 5,
        autoRestartOnInfraFailure: true,
        maxInfraRestarts: 2,
        extraArgs: []
      }, {
        repoRoot,
        runStep: async (label, args) => {
          steps.push({ label, args });
          return label === 'Repair Canary' ? 2 : 0;
        },
        log: (message) => logs.push(message),
        error: (message) => logs.push(`ERR:${message}`)
      });

      assert.equal(result.gateCode, 0);
      assert.equal(result.repairCanaryCode, 2);
      assert.equal(result.cleanupCode, 0);
      assert.ok(steps.some(step => step.label === 'Cleanup'));
      assert.ok(logs.some(message => message.includes('Repair canary failed with code 2 (non-blocking)')));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});