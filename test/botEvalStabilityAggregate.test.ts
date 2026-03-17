import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  parseStabilityAggregateArgs,
  runStabilityAggregate
} from '../scripts/botEvalStabilityAggregate';

function writeJson(filePath: string, value: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function createRunDir(root: string, name: string, options?: {
  baselineDir?: string;
  passRate?: number;
  avgMs?: number;
  avgMsDelta?: number;
  gatePassed?: boolean;
  gateViolation?: string;
}): string {
  const dir = path.join(root, name);
  const baselineDir = options?.baselineDir || path.join(root, 'stable-baseline');
  writeJson(path.join(dir, 'summary.json'), [
    {
      scenario: 'ts-todo-oracle',
      passRate: options?.passRate ?? 1,
      rawRunPassRate: 1,
      fallbackDependencyRunRate: 0,
      avgMs: options?.avgMs ?? 120,
      runsWithPlannerError: 0,
      runsWithJsonRepairError: 0,
      runsWithSchemaFailure: 0,
      runsWithJsonParseFailure: 0,
      runsWithPlaceholderFailure: 0,
      runsWithOtherParseFailure: 0
    }
  ]);
  writeJson(path.join(dir, 'compare.json'), {
    generatedAt: '2026-03-17T00:00:00.000Z',
    baselineDir,
    candidateDir: dir,
    scenarios: [
      {
        scenario: 'ts-todo-oracle',
        delta: {
          passRate: 0,
          rawRunPassRate: 0,
          fallbackDependencyRunRate: 0,
          avgMs: options?.avgMsDelta ?? 10
        }
      }
    ],
    gate: {
      passed: options?.gatePassed ?? true,
      violations: options?.gatePassed === false
        ? [{ message: options?.gateViolation || 'latency regression' }]
        : []
    }
  });
  return dir;
}

describe('botEvalStabilityAggregate', () => {
  it('parses explicit input and output arguments', () => {
    const opts = parseStabilityAggregateArgs([
      '--input', 'run-a',
      '--input', 'run-b',
      '--out', 'aggregate.json',
      '--outMd', 'aggregate.md'
    ]);

    assert.equal(opts.inputs.length, 2);
    assert.equal(opts.outJson, path.resolve('aggregate.json'));
    assert.equal(opts.outMd, path.resolve('aggregate.md'));
  });

  it('aggregates runs, records gate failures, and writes JSON plus markdown outputs', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-stability-aggregate-'));
    try {
      const runA = createRunDir(tmp, 'release_gate_1001', { passRate: 1, avgMs: 100, avgMsDelta: 5, gatePassed: true });
      const runB = createRunDir(tmp, 'release_gate_1002', { passRate: 0.8, avgMs: 140, avgMsDelta: 25, gatePassed: false, gateViolation: 'avgMs regression' });
      const outJson = path.join(tmp, 'aggregate.json');
      const outMd = path.join(tmp, 'aggregate.md');
      const logs: string[] = [];

      const report = await runStabilityAggregate({
        inputs: [runA, runB],
        outJson,
        outMd
      }, {
        now: () => '2026-03-17T12:00:00.000Z',
        log: message => logs.push(message)
      });

      assert.equal(report.generatedAt, '2026-03-17T12:00:00.000Z');
      assert.equal(report.baselineDir, path.join(tmp, 'stable-baseline'));
      assert.equal(report.allGatePassed, false);
      assert.equal(report.gateFailures.length, 1);
      assert.equal(report.gateFailures[0]?.runDir, runB);
      assert.match(report.gateFailures[0]?.message || '', /avgMs regression/);
      assert.equal(report.scenarios.length, 1);
      assert.equal(report.scenarios[0]?.runs, 2);
      assert.equal(report.scenarios[0]?.passRate.avg, 0.9);
      assert.equal(report.scenarios[0]?.avgMs.avg, 120);
      assert.equal(report.scenarios[0]?.avgMsDeltaVsBaseline.max, 25);

      const jsonReport = JSON.parse(fs.readFileSync(outJson, 'utf8'));
      assert.equal(jsonReport.allGatePassed, false);

      const markdown = fs.readFileSync(outMd, 'utf8');
      assert.match(markdown, /# BotEval Long Stability Aggregate/);
      assert.match(markdown, /## Gate Failures/);
      assert.match(markdown, /avgMs regression/);
      assert.ok(logs.some(message => message.includes('Aggregate JSON:')));
      assert.ok(logs.some(message => message.includes('Aggregate MD:')));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('skips inputs with a mismatched baseline and emits a warning', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-stability-aggregate-'));
    try {
      const runA = createRunDir(tmp, 'release_gate_2001', { baselineDir: path.join(tmp, 'stable-a'), passRate: 1, avgMs: 90, avgMsDelta: 5 });
      const runB = createRunDir(tmp, 'release_gate_2002', { baselineDir: path.join(tmp, 'stable-b'), passRate: 0.2, avgMs: 400, avgMsDelta: 200, gatePassed: false, gateViolation: 'should be skipped' });
      const warnings: string[] = [];

      const report = await runStabilityAggregate({
        inputs: [runA, runB],
        outJson: path.join(tmp, 'aggregate.json'),
        outMd: path.join(tmp, 'aggregate.md')
      }, {
        now: () => '2026-03-17T12:00:00.000Z',
        warn: message => warnings.push(message),
        log: () => undefined
      });

      assert.equal(report.baselineDir, path.join(tmp, 'stable-a'));
      assert.equal(report.scenarios.length, 1);
      assert.equal(report.scenarios[0]?.runs, 1);
      assert.equal(report.allGatePassed, true);
      assert.equal(report.gateFailures.length, 0);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0] || '', /Baseline mismatch/);
      assert.match(warnings[0] || '', /release_gate_2002/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});