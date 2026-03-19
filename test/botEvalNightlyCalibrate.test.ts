import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildCalibrationRecommendation,
  computePercentile,
  computeRecommendedLatencyMultiplier,
  runNightlyCalibration
} from '../scripts/botEvalNightlyCalibrate';

function writeJson(filePath: string, value: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function createNightlyRun(params: {
  root: string;
  runId: number;
  ratioByScenario: Record<string, number>;
  gatePassed: boolean;
  allGatePassed: boolean;
  rawMin?: number;
  fallbackMax?: number;
  parseErrorTotal?: number;
  includeHistoricalCompletionArtifacts?: boolean;
}): string {
  const runDir = path.join(params.root, `release_gate_ci_nightly_${params.runId}_1`);
  fs.mkdirSync(runDir, { recursive: true });
  const scenarios = Object.entries(params.ratioByScenario).map(([scenario, ratio]) => ({
    scenario,
    baseline: { avgMs: 1000 },
    candidate: { avgMs: Math.round(1000 * ratio) },
    delta: { avgMs: Math.round(1000 * ratio) - 1000 }
  }));
  writeJson(path.join(runDir, 'summary.json'), scenarios.map(s => ({
    scenario: s.scenario,
    passRate: 1,
    rawRunPassRate: 1,
    fallbackDependencyRunRate: 0,
    avgMs: s.candidate.avgMs
  })));
  writeJson(path.join(runDir, 'compare.json'), {
    baselineDir: 'projects/bot_eval_run/stable_baseline',
    gate: { passed: params.gatePassed },
    scenarios
  });
  const parseErrorValue = Number(params.parseErrorTotal) || 0;
  writeJson(path.join(runDir, 'stability_aggregate.json'), {
    allGatePassed: params.allGatePassed,
    scenarios: scenarios.map(s => ({
      scenario: s.scenario,
      rawRunPassRate: { min: params.rawMin == null ? 1 : params.rawMin },
      fallbackDependencyRunRate: { max: params.fallbackMax == null ? 0 : params.fallbackMax },
      parseErrorRunsTotal: {
        planner: parseErrorValue,
        jsonRepair: 0,
        schema: 0,
        jsonParse: 0,
        placeholder: 0,
        other: 0
      }
    }))
  });
  writeJson(path.join(runDir, 'latency_guard.json'), {
    passed: true,
    violations: []
  });
  writeJson(path.join(runDir, 'trend_guard.json'), {
    passed: true,
    violations: []
  });
  if (params.includeHistoricalCompletionArtifacts !== false) {
    writeJson(path.join(runDir, 'calibration_recommendation.json'), {
      readiness: {
        ready_to_tighten_pr: false,
        reason_if_not_ready: '',
        last3NightlyRunIds: []
      }
    });
    writeJson(path.join(runDir, 'baseline_promotion.json'), {
      qualified: true,
      promoted: true,
      streakBefore: 1,
      streakAfter: 2,
      promotionMessage: 'promoted after streak 2/2'
    });
  }
  return runDir;
}

describe('botEvalNightlyCalibrate', () => {
  it('computes deterministic p95 percentile', () => {
    const value = computePercentile([1.05, 1.01, 1.08, 1.02, 1.1, 1.04, 1.03, 1.06, 1.09, 1.07], 0.95);
    assert.equal(value, 1.1);
  });

  it('computes recommendation as round_up(p95 * 1.15, 0.01)', () => {
    const multiplier = computeRecommendedLatencyMultiplier(1.123);
    assert.equal(multiplier, 1.3);
  });

  it('builds calibration json/md from 10 nightly fixture runs', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-nightly-calibrate-'));
    try {
      for (let i = 1; i <= 10; i++) {
        createNightlyRun({
          root: tmp,
          runId: 1000 + i,
          ratioByScenario: {
            'node-api-oracle': 1 + (i / 100),
            'python-ai-stdlib-oracle': 0.9 + (i / 100),
            'ts-todo-oracle': 1
          },
          gatePassed: true,
          allGatePassed: true
        });
      }

      const outJson = path.join(tmp, 'out', 'calibration_recommendation.json');
      const outMd = path.join(tmp, 'out', 'calibration_recommendation.md');
      await runNightlyCalibration({
        rootDir: tmp,
        window: 10,
        outJson,
        outMd
      });

      const report = JSON.parse(fs.readFileSync(outJson, 'utf8'));
      assert.equal(report.window, 10);
      assert.equal(report.inputs.length, 10);
      assert.equal(report.baselineDir, 'projects/bot_eval_run/stable_baseline');
      assert.equal(report.readiness.ready_to_tighten_pr, true);
      assert.deepEqual(report.readiness.last3NightlyRunIds, ['1010', '1009', '1008']);

      const node = report.scenarios.find((s: any) => s.scenario === 'node-api-oracle');
      assert.ok(node);
      assert.equal(node.samples, 10);
      assert.equal(node.latencyRatioP95, 1.1);
      assert.equal(node.recommendedLatencyMultiplier, 1.27);

      const md = fs.readFileSync(outMd, 'utf8');
      assert.ok(md.includes('Nightly Calibration Recommendation'));
      assert.ok(md.includes('| node-api-oracle |'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('ignores incomplete newer nightly runs and uses only completed runs', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-nightly-calibrate-'));
    try {
      const completed = createNightlyRun({
        root: tmp,
        runId: 2001,
        ratioByScenario: {
          'node-api-oracle': 1.02,
          'python-ai-stdlib-oracle': 1.01,
          'ts-todo-oracle': 1
        },
        gatePassed: true,
        allGatePassed: true
      });
      const incompleteDir = path.join(tmp, 'release_gate_ci_nightly_999999_1');
      fs.mkdirSync(incompleteDir, { recursive: true });
      writeJson(path.join(incompleteDir, 'summary.json'), []);

      const report = buildCalibrationRecommendation({ rootDir: tmp, window: 10 });
      assert.equal(report.inputs.length, 1);
      assert.equal(report.inputs[0], completed);
      assert.equal(report.readiness.ready_to_tighten_pr, false);
      assert.match(report.readiness.reason_if_not_ready, /Need at least 3 nightly runs/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('treats the newest pre-calibration nightly run as eligible when two prior nightly runs completed', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-nightly-calibrate-'));
    try {
      createNightlyRun({
        root: tmp,
        runId: 3001,
        ratioByScenario: {
          'node-api-oracle': 1.01,
          'python-ai-stdlib-oracle': 1.01,
          'ts-todo-oracle': 1.01
        },
        gatePassed: true,
        allGatePassed: true
      });
      createNightlyRun({
        root: tmp,
        runId: 3002,
        ratioByScenario: {
          'node-api-oracle': 1.02,
          'python-ai-stdlib-oracle': 1.02,
          'ts-todo-oracle': 1.02
        },
        gatePassed: true,
        allGatePassed: true
      });
      const currentRun = createNightlyRun({
        root: tmp,
        runId: 3003,
        ratioByScenario: {
          'node-api-oracle': 1.03,
          'python-ai-stdlib-oracle': 1.03,
          'ts-todo-oracle': 1.03
        },
        gatePassed: true,
        allGatePassed: true,
        includeHistoricalCompletionArtifacts: false
      });

      const report = buildCalibrationRecommendation({ rootDir: tmp, window: 10 });
      assert.equal(report.readiness.ready_to_tighten_pr, true);
      assert.deepEqual(report.readiness.last3NightlyRunIds, ['3003', '3002', '3001']);
      assert.equal(report.inputs[0], currentRun);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('blocks readiness when one of the last three nightly runs failed before calibration completion', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-nightly-calibrate-'));
    try {
      createNightlyRun({
        root: tmp,
        runId: 4001,
        ratioByScenario: {
          'node-api-oracle': 1.01,
          'python-ai-stdlib-oracle': 1.01,
          'ts-todo-oracle': 1.01
        },
        gatePassed: true,
        allGatePassed: true
      });
      createNightlyRun({
        root: tmp,
        runId: 4002,
        ratioByScenario: {
          'node-api-oracle': 1.02,
          'python-ai-stdlib-oracle': 1.02,
          'ts-todo-oracle': 1.02
        },
        gatePassed: true,
        allGatePassed: true
      });
      createNightlyRun({
        root: tmp,
        runId: 4003,
        ratioByScenario: {
          'node-api-oracle': 1.03,
          'python-ai-stdlib-oracle': 1.03,
          'ts-todo-oracle': 1.03
        },
        gatePassed: true,
        allGatePassed: true,
        includeHistoricalCompletionArtifacts: false
      });
      createNightlyRun({
        root: tmp,
        runId: 4004,
        ratioByScenario: {
          'node-api-oracle': 1.04,
          'python-ai-stdlib-oracle': 1.04,
          'ts-todo-oracle': 1.04
        },
        gatePassed: true,
        allGatePassed: true,
        includeHistoricalCompletionArtifacts: false
      });

      const report = buildCalibrationRecommendation({ rootDir: tmp, window: 10 });
      assert.equal(report.readiness.ready_to_tighten_pr, false);
      assert.deepEqual(report.readiness.last3NightlyRunIds, ['4004', '4003', '4002']);
      assert.match(report.readiness.reason_if_not_ready, /4003.*missing required completion artifacts/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails with clear error when no completed nightly run directories exist', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-nightly-calibrate-'));
    try {
      const runDir = path.join(tmp, 'release_gate_ci_nightly_123_1');
      fs.mkdirSync(runDir, { recursive: true });
      writeJson(path.join(runDir, 'summary.json'), []);
      assert.throws(
        () => buildCalibrationRecommendation({ rootDir: tmp, window: 10 }),
        /No completed nightly run directories found/i
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails with clear error when only compare and stability files are present', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-nightly-calibrate-'));
    try {
      const runDir = path.join(tmp, 'release_gate_ci_nightly_124_1');
      fs.mkdirSync(runDir, { recursive: true });
      writeJson(path.join(runDir, 'compare.json'), {
        baselineDir: 'projects/bot_eval_run/stable_baseline',
        gate: { passed: true },
        scenarios: []
      });
      writeJson(path.join(runDir, 'stability_aggregate.json'), { allGatePassed: true, scenarios: [] });
      assert.throws(
        () => buildCalibrationRecommendation({ rootDir: tmp, window: 10 }),
        /No completed nightly run directories found/i
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('tolerates partial stability aggregate schema by marking readiness not ready', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-nightly-calibrate-'));
    try {
      for (const runId of [5101, 5102, 5103]) {
        const runDir = path.join(tmp, `release_gate_ci_nightly_${runId}_1`);
        fs.mkdirSync(runDir, { recursive: true });
        writeJson(path.join(runDir, 'summary.json'), [
          { scenario: 'ts-todo-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 1020 }
        ]);
        writeJson(path.join(runDir, 'compare.json'), {
          baselineDir: 'projects/bot_eval_run/stable_baseline',
          gate: { passed: true },
          scenarios: [
            { scenario: 'ts-todo-oracle', baseline: { avgMs: 1000 }, candidate: { avgMs: 1020 } }
          ]
        });
        writeJson(path.join(runDir, 'stability_aggregate.json'), {
          allGatePassed: true
        });
        writeJson(path.join(runDir, 'latency_guard.json'), { passed: true, violations: [] });
        writeJson(path.join(runDir, 'trend_guard.json'), { passed: true, violations: [] });
        if (runId !== 5103) {
          writeJson(path.join(runDir, 'calibration_recommendation.json'), {
            readiness: {
              ready_to_tighten_pr: false,
              reason_if_not_ready: '',
              last3NightlyRunIds: []
            }
          });
          writeJson(path.join(runDir, 'baseline_promotion.json'), {
            qualified: true,
            promoted: true,
            streakBefore: 1,
            streakAfter: 2,
            promotionMessage: 'promoted after streak 2/2'
          });
        }
      }

      const report = buildCalibrationRecommendation({ rootDir: tmp, window: 10 });
      const scenario = report.scenarios.find((s: any) => s.scenario === 'ts-todo-oracle');
      assert.ok(scenario, 'latency calibration should still be computed from compare.json');
      assert.equal(scenario!.samples, 3);
      assert.equal(report.readiness.ready_to_tighten_pr, false);
      assert.match(report.readiness.reason_if_not_ready, /stability_aggregate\.json is incomplete/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('discovers local release_gate_<timestamp> dirs when includeLocalRuns is true', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-nightly-calibrate-'));
    try {
      for (let i = 0; i < 3; i++) {
        const ts = 1773000000000 + i * 100000;
        const runDir = path.join(tmp, `release_gate_${ts}`);
        fs.mkdirSync(runDir, { recursive: true });
        writeJson(path.join(runDir, 'summary.json'), [
          { scenario: 'ts-todo-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 1050 }
        ]);
        writeJson(path.join(runDir, 'compare.json'), {
          baselineDir: 'baseline',
          gate: { passed: true },
          scenarios: [
            { scenario: 'ts-todo-oracle', baseline: { avgMs: 1000 }, candidate: { avgMs: 1050 } }
          ]
        });
      }

      // Default mode should not find them
      assert.throws(
        () => buildCalibrationRecommendation({ rootDir: tmp, window: 10 }),
        /No completed nightly run directories found/i
      );

      // With includeLocalRuns they should be found and calibration should work
      const report = buildCalibrationRecommendation({ rootDir: tmp, window: 10, includeLocalRuns: true });
      assert.equal(report.inputs.length, 3);
      assert.equal(report.readiness.ready_to_tighten_pr, true);
      const ts = report.scenarios.find((s: any) => s.scenario === 'ts-todo-oracle');
      assert.ok(ts);
      assert.equal(ts!.samples, 3);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('extracts run ID from local release_gate_<timestamp> dir name', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-nightly-calibrate-'));
    try {
      for (const ts of [1773000000001, 1773000000002, 1773000000003]) {
        const runDir = path.join(tmp, `release_gate_${ts}`);
        fs.mkdirSync(runDir, { recursive: true });
        writeJson(path.join(runDir, 'summary.json'), [
          { scenario: 'node-api-oracle', passRate: 1, avgMs: 900 }
        ]);
        writeJson(path.join(runDir, 'compare.json'), {
          baselineDir: 'baseline',
          gate: { passed: true },
          scenarios: [{ scenario: 'node-api-oracle', baseline: { avgMs: 1000 }, candidate: { avgMs: 900 } }]
        });
      }
      const report = buildCalibrationRecommendation({ rootDir: tmp, window: 10, includeLocalRuns: true });
      // Run IDs should be numeric timestamps, not full dir names
      for (const id of report.readiness.last3NightlyRunIds) {
        assert.match(id, /^\d+$/);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('skips scenarios with zero baseline avgMs instead of throwing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-nightly-calibrate-'));
    try {
      for (let i = 0; i < 3; i++) {
        const ts = 1773000000000 + i * 100000;
        const runDir = path.join(tmp, `release_gate_${ts}`);
        fs.mkdirSync(runDir, { recursive: true });
        writeJson(path.join(runDir, 'summary.json'), [
          { scenario: 'ts-todo-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 1050 },
          { scenario: 'node-project-api-large', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 140000 }
        ]);
        writeJson(path.join(runDir, 'compare.json'), {
          baselineDir: 'baseline',
          gate: { passed: true },
          scenarios: [
            { scenario: 'ts-todo-oracle', baseline: { avgMs: 1000 }, candidate: { avgMs: 1050 } },
            { scenario: 'node-project-api-large', baseline: { avgMs: 0 }, candidate: { avgMs: 140000 } }
          ]
        });
      }
      const report = buildCalibrationRecommendation({ rootDir: tmp, window: 10, includeLocalRuns: true });
      // Should have ts-todo but NOT node-project-api-large (no baseline)
      const tsScenario = report.scenarios.find((s: any) => s.scenario === 'ts-todo-oracle');
      const largeScenario = report.scenarios.find((s: any) => s.scenario === 'node-project-api-large');
      assert.ok(tsScenario, 'ts-todo-oracle should be present');
      assert.equal(largeScenario, undefined, 'node-project-api-large should be skipped (no baseline)');
      assert.equal(report.readiness.ready_to_tighten_pr, true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
