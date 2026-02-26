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

  it('fails with clear error when compare.json is missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-nightly-calibrate-'));
    try {
      const runDir = path.join(tmp, 'release_gate_ci_nightly_123_1');
      fs.mkdirSync(runDir, { recursive: true });
      writeJson(path.join(runDir, 'summary.json'), []);
      writeJson(path.join(runDir, 'stability_aggregate.json'), { allGatePassed: true, scenarios: [] });
      assert.throws(
        () => buildCalibrationRecommendation({ rootDir: tmp, window: 10 }),
        /Missing compare\.json/i
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails with clear error when summary.json is missing', () => {
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
        /Missing summary\.json/i
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
