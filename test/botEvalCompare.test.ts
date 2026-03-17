import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  classifyFailureCluster,
  collectFailureClustersForRun,
} from '../scripts/botEvalBatch';
import { compareSummaries, evaluateAcceptanceGate, parseCompareArgs, runCompare } from '../scripts/botEvalCompare';

function createCompareRunResult(params: {
  scenario?: string;
  ok?: boolean;
  durationMs?: number;
}) {
  return {
    scenario: params.scenario || 'ts-todo-oracle',
    runIndex: 1,
    ok: params.ok ?? true,
    exitCode: params.ok === false ? 1 : 0,
    durationMs: params.durationMs ?? 100,
    outDir: 'run-dir',
    diagnostics: [],
    timedOut: false,
    parseStats: {
      plannerFailures: 0,
      schemaFailures: 0,
      jsonRepairFailures: 0,
      parseFailures: 0,
      jsonParseFailures: 0,
      placeholderFailures: 0,
      otherFailures: 0
    },
    deterministicFallback: {
      mode: 'on-fail',
      tsTodo: {
        activations: 0,
        recoveries: 0,
        targetedActivations: 0,
        targetedRecoveries: 0,
        canonicalActivations: 0,
        canonicalRecoveries: 0,
        rawPasses: 0,
        rawFailures: 0,
        recoveredByFallback: 0
      },
      tsCsv: {
        activations: 0,
        recoveries: 0,
        targetedActivations: 0,
        targetedRecoveries: 0,
        canonicalActivations: 0,
        canonicalRecoveries: 0,
        rawPasses: 0,
        rawFailures: 0,
        recoveredByFallback: 0
      },
      nodeApi: {
        activations: 0,
        recoveries: 0,
        targetedActivations: 0,
        targetedRecoveries: 0,
        canonicalActivations: 0,
        canonicalRecoveries: 0,
        rawPasses: 0,
        rawFailures: 0,
        recoveredByFallback: 0
      },
      totalActivations: 0,
      totalRecoveries: 0,
      totalTargetedActivations: 0,
      totalTargetedRecoveries: 0,
      totalCanonicalActivations: 0,
      totalCanonicalRecoveries: 0,
      totalRawPasses: 0,
      totalRawFailures: 0,
      totalRecoveredByFallback: 0,
      fallbackDependencyRate: 0
    },
    infraFailure: null
  };
}

describe('botEval compare and failure clustering helpers', () => {
  it('classifies common diagnostics into stable clusters', () => {
    assert.equal(
      classifyFailureCluster('src/server.js must export createServer (e.g. module.exports = { createServer })'),
      'node_contract'
    );
    assert.equal(
      classifyFailureCluster('src/store.ts must export TaskStore as named export (not default-only)'),
      'ts_contract'
    );
    assert.equal(
      classifyFailureCluster('Model output is not valid JSON'),
      'json_parse'
    );
  });

  it('aggregates run-level failure clusters from diagnostics and parse counters', () => {
    const clusters = collectFailureClustersForRun({
      scenario: 'node-api-oracle',
      runIndex: 1,
      ok: false,
      exitCode: 2,
      durationMs: 1000,
      outDir: 'x',
      diagnostics: [
        'src/server.js must export createServer (e.g. module.exports = { createServer })',
        'Command failed: node --test tests/oracle.test.js (exit=1, timedOut=false)'
      ],
      timedOut: true,
      parseStats: {
        plannerFailures: 0,
        schemaFailures: 2,
        jsonRepairFailures: 1,
        parseFailures: 3,
        jsonParseFailures: 1,
        placeholderFailures: 0,
        otherFailures: 0
      },
      deterministicFallback: {
        mode: 'on-fail',
        tsTodo: {
          activations: 0,
          recoveries: 0,
          targetedActivations: 0,
          targetedRecoveries: 0,
          canonicalActivations: 0,
          canonicalRecoveries: 0,
          rawPasses: 0,
          rawFailures: 0,
          recoveredByFallback: 0
        },
        nodeApi: {
          activations: 1,
          recoveries: 0,
          targetedActivations: 1,
          targetedRecoveries: 0,
          canonicalActivations: 0,
          canonicalRecoveries: 0,
          rawPasses: 0,
          rawFailures: 1,
          recoveredByFallback: 0
        },
        totalActivations: 1,
        totalRecoveries: 0,
        totalTargetedActivations: 1,
        totalTargetedRecoveries: 0,
        totalCanonicalActivations: 0,
        totalCanonicalRecoveries: 0,
        totalRawPasses: 0,
        totalRawFailures: 1,
        totalRecoveredByFallback: 0,
        fallbackDependencyRate: 0
      }
    } as any);

    const asMap = new Map(clusters.map(c => [c.id, c.count]));
    assert.equal(asMap.get('node_contract'), 1);
    assert.equal(asMap.get('schema_shape'), 2);
    assert.equal(asMap.get('json_parse'), 1);
    assert.equal(asMap.get('command_runtime'), 1);
    assert.equal(asMap.get('timeout'), 1);
  });

  it('compares baseline and candidate summary rows with deltas', () => {
    const deltas = compareSummaries({
      baselineSummaryRows: [
        {
          scenario: 'node-api-oracle',
          passRate: 0.2,
          rawRunPassRate: 0.1,
          fallbackDependencyRunRate: 0.8,
          avgMs: 1000,
          topFailureClusters: [{ id: 'node_contract', count: 10 }]
        }
      ],
      candidateSummaryRows: [
        {
          scenario: 'node-api-oracle',
          passRate: 1,
          rawRunPassRate: 0.4,
          fallbackDependencyRunRate: 0.3,
          avgMs: 900,
          topFailureClusters: [{ id: 'node_contract', count: 2 }]
        }
      ]
    });

    assert.equal(deltas.length, 1);
    const row = deltas[0];
    assert.equal(row.scenario, 'node-api-oracle');
    assert.equal(row.delta.passRate, 0.8);
    assert.ok(Math.abs(row.delta.rawRunPassRate - 0.3) < 1e-9);
    assert.equal(row.delta.fallbackDependencyRunRate, -0.5);
    assert.equal(row.delta.avgMs, -100);
  });

  it('limits compare output to candidate scenarios when scenarioIds are provided', () => {
    const deltas = compareSummaries({
      baselineSummaryRows: [
        {
          scenario: 'node-api-oracle',
          passRate: 1,
          rawRunPassRate: 1,
          fallbackDependencyRunRate: 0,
          avgMs: 1000
        },
        {
          scenario: 'ts-csv-oracle',
          passRate: 0,
          rawRunPassRate: 0,
          fallbackDependencyRunRate: 0,
          avgMs: 0
        }
      ],
      candidateSummaryRows: [
        {
          scenario: 'ts-csv-oracle',
          passRate: 1,
          rawRunPassRate: 1,
          fallbackDependencyRunRate: 0,
          avgMs: 900
        }
      ],
      scenarioIds: ['ts-csv-oracle']
    });

    assert.deepEqual(deltas.map(row => row.scenario), ['ts-csv-oracle']);
    assert.equal(deltas[0].delta.passRate, 1);
  });

  it('does not penalize missing non-candidate scenarios in gate evaluation', () => {
    const scenarios = compareSummaries({
      baselineSummaryRows: [
        { scenario: 'ts-todo-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 50000 },
        { scenario: 'node-api-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 90000 },
        { scenario: 'ts-csv-oracle', passRate: 0, rawRunPassRate: 0, fallbackDependencyRunRate: 0, avgMs: 0 }
      ],
      candidateSummaryRows: [
        { scenario: 'ts-csv-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 100000 }
      ],
      scenarioIds: ['ts-csv-oracle']
    });

    const gate = evaluateAcceptanceGate({
      enabled: true,
      scenarios,
      clusterDelta: [],
      thresholds: {
        minPassRateDelta: 0,
        scenarioOverrides: {
          'ts-csv-oracle': { maxLatencyMultiplier: 1.26 }
        }
      }
    });

    assert.equal(gate.passed, true);
    assert.deepEqual(gate.violations, []);
  });

  it('evaluates acceptance gate with scenario and cluster thresholds', () => {
    const scenarios = compareSummaries({
      baselineSummaryRows: [
        {
          scenario: 'node-api-oracle',
          passRate: 0.8,
          rawRunPassRate: 0.4,
          fallbackDependencyRunRate: 0.2,
          avgMs: 1000
        }
      ],
      candidateSummaryRows: [
        {
          scenario: 'node-api-oracle',
          passRate: 0.6,
          rawRunPassRate: 0.3,
          fallbackDependencyRunRate: 0.7,
          avgMs: 900
        }
      ]
    });

    const gate = evaluateAcceptanceGate({
      enabled: true,
      scenarios,
      clusterDelta: [
        { id: 'json_parse', baseline: 1, candidate: 4, delta: 3 }
      ],
      thresholds: {
        minPassRateDelta: 0,
        maxFallbackDependencyRunRate: 0.6,
        maxFallbackDependencyRunRateDelta: 0.2,
        maxClusterIncreaseRules: [{ id: 'json_parse', maxIncrease: 1 }]
      }
    });

    assert.equal(gate.enabled, true);
    assert.equal(gate.passed, false);
    assert.ok(gate.violations.some(v => v.metric === 'passRateDelta'));
    assert.ok(gate.violations.some(v => v.metric === 'fallbackDependencyRunRate'));
    assert.ok(gate.violations.some(v => v.metric === 'fallbackDependencyRunRateDelta'));
    assert.ok(gate.violations.some(v => v.metric === 'clusterDelta:json_parse'));
  });

  it('applies scenario-specific threshold overrides', () => {
    const scenarios = compareSummaries({
      baselineSummaryRows: [
        {
          scenario: 'ts-todo-oracle',
          passRate: 1,
          rawRunPassRate: 1,
          fallbackDependencyRunRate: 0,
          avgMs: 1000
        }
      ],
      candidateSummaryRows: [
        {
          scenario: 'ts-todo-oracle',
          passRate: 1,
          rawRunPassRate: 0.2,
          fallbackDependencyRunRate: 0.8,
          avgMs: 900
        }
      ]
    });

    const strictGlobal = evaluateAcceptanceGate({
      enabled: true,
      scenarios,
      clusterDelta: [],
      thresholds: {
        maxFallbackDependencyRunRate: 0.6,
        maxFallbackDependencyRunRateDelta: 0.2
      }
    });
    assert.equal(strictGlobal.passed, false);

    const relaxedScenario = evaluateAcceptanceGate({
      enabled: true,
      scenarios,
      clusterDelta: [],
      thresholds: {
        maxFallbackDependencyRunRate: 0.6,
        maxFallbackDependencyRunRateDelta: 0.2,
        scenarioOverrides: {
          'ts-todo-oracle': {
            maxFallbackDependencyRunRate: 0.85,
            maxFallbackDependencyRunRateDelta: 0.85
          }
        }
      }
    });
    assert.equal(relaxedScenario.passed, true);
  });

  it('enforces latency multiplier threshold', () => {
    const scenarios = compareSummaries({
      baselineSummaryRows: [
        { scenario: 'node-api-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 100000 }
      ],
      candidateSummaryRows: [
        { scenario: 'node-api-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 130000 }
      ]
    });

    const withinLimit = evaluateAcceptanceGate({
      enabled: true,
      scenarios,
      clusterDelta: [],
      thresholds: { maxLatencyMultiplier: 1.5 }
    });
    assert.equal(withinLimit.passed, true);

    const exceeded = evaluateAcceptanceGate({
      enabled: true,
      scenarios,
      clusterDelta: [],
      thresholds: { maxLatencyMultiplier: 1.2 }
    });
    assert.equal(exceeded.passed, false);
    assert.ok(exceeded.violations.some(v => v.metric === 'latencyMultiplier'));
  });

  it('skips latency check when baseline avgMs is zero (new scenario)', () => {
    const scenarios = compareSummaries({
      baselineSummaryRows: [
        { scenario: 'node-project-api-large', passRate: 0, rawRunPassRate: 0, fallbackDependencyRunRate: 0, avgMs: 0 }
      ],
      candidateSummaryRows: [
        { scenario: 'node-project-api-large', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 141769 }
      ]
    });
    const gate = evaluateAcceptanceGate({
      enabled: true,
      scenarios,
      clusterDelta: [],
      thresholds: { maxLatencyMultiplier: 1.2 }
    });
    assert.ok(!gate.violations.some(v => v.metric === 'latencyMultiplier'));
  });

  it('applies per-scenario latency multiplier override', () => {
    const scenarios = compareSummaries({
      baselineSummaryRows: [
        { scenario: 'ts-todo-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 50000 },
        { scenario: 'node-api-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 90000 }
      ],
      candidateSummaryRows: [
        { scenario: 'ts-todo-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 70000 },
        { scenario: 'node-api-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 100000 }
      ]
    });

    const gate = evaluateAcceptanceGate({
      enabled: true,
      scenarios,
      clusterDelta: [],
      thresholds: {
        maxLatencyMultiplier: 1.1,
        scenarioOverrides: {
          'ts-todo-oracle': { maxLatencyMultiplier: 1.5 }
        }
      }
    });
    // ts-todo: 70000/50000 = 1.4x, override allows 1.5x → pass
    // node-api: 100000/90000 = 1.11x, global allows 1.1x → fail
    assert.equal(gate.passed, false);
    assert.ok(gate.violations.some(v => v.scenario === 'node-api-oracle' && v.metric === 'latencyMultiplier'));
    assert.ok(!gate.violations.some(v => v.scenario === 'ts-todo-oracle' && v.metric === 'latencyMultiplier'));
  });

  it('keeps CI gate scenario overrides aligned with nightly overrides', () => {
    const rootDir = path.resolve(__dirname, '..');
    const ciConfig = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'scripts', 'config', 'botEvalGate.ci.json'), 'utf8')
    ) as {
      scenarioOverrides?: Record<string, { maxLatencyMultiplier?: number } | undefined>;
    };
    const nightlyConfig = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'scripts', 'config', 'botEvalGate.nightly.json'), 'utf8')
    ) as {
      scenarioOverrides?: Record<string, { maxLatencyMultiplier?: number } | undefined>;
    };

    const ciScenarioIds = Object.keys(ciConfig.scenarioOverrides || {}).sort();
    const nightlyScenarioIds = Object.keys(nightlyConfig.scenarioOverrides || {}).sort();

    assert.deepEqual(ciScenarioIds, nightlyScenarioIds);

    const nightlyLatencyOverrides = Object.entries(nightlyConfig.scenarioOverrides || {})
      .filter(([, thresholds]) => thresholds?.maxLatencyMultiplier !== undefined)
      .map(([scenarioId, thresholds]) => [scenarioId, thresholds?.maxLatencyMultiplier] as const)
      .sort(([left], [right]) => left.localeCompare(right));
    const ciLatencyOverrides = nightlyLatencyOverrides.map(([scenarioId]) => [
      scenarioId,
      ciConfig.scenarioOverrides?.[scenarioId]?.maxLatencyMultiplier
    ] as const);

    assert.deepEqual(ciLatencyOverrides, nightlyLatencyOverrides);
  });

  it('parses compare args for baseline, candidate, and gate options', () => {
    const opts = parseCompareArgs([
      '--baseline', 'baseline-dir',
      '--candidate', 'candidate-dir',
      '--out', 'compare.json',
      '--gate',
      '--topClusters', '5',
      '--maxClusterIncrease', 'json_parse:2'
    ]);

    assert.equal(opts.baselineDir, 'baseline-dir');
    assert.equal(opts.candidateDir, 'candidate-dir');
    assert.equal(opts.outPath, 'compare.json');
    assert.equal(opts.gateEnabled, true);
    assert.equal(opts.topClusters, 5);
    assert.deepEqual(opts.maxClusterIncreaseRules, [{ id: 'json_parse', maxIncrease: 2 }]);
  });

  it('writes compare report and keeps exit code unset on passing gate', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-compare-'));
    try {
      const baselineDir = path.join(root, 'baseline');
      const candidateDir = path.join(root, 'candidate');
      fs.mkdirSync(baselineDir, { recursive: true });
      fs.mkdirSync(candidateDir, { recursive: true });

      fs.writeFileSync(path.join(baselineDir, 'results.json'), JSON.stringify([
        createCompareRunResult({ durationMs: 100 })
      ], null, 2), 'utf8');
      fs.writeFileSync(path.join(candidateDir, 'results.json'), JSON.stringify([
        createCompareRunResult({ durationMs: 110 })
      ], null, 2), 'utf8');

      const exitCodes: number[] = [];
      const logs: string[] = [];
      const outPath = path.join(candidateDir, 'nested', 'compare.json');
      const result = await runCompare({
        ...parseCompareArgs(['--baseline', baselineDir, '--candidate', candidateDir, '--gate']),
        outPath,
        maxLatencyMultiplier: 1.5
      }, {
        now: () => '2026-03-17T12:00:00.000Z',
        log: message => logs.push(message),
        setExitCode: code => exitCodes.push(code)
      });

      assert.equal(result.outPath, path.resolve(outPath));
      assert.equal(result.report.generatedAt, '2026-03-17T12:00:00.000Z');
      assert.equal(result.report.gate.passed, true);
      assert.deepEqual(exitCodes, []);
      assert.ok(fs.existsSync(outPath));
      const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      assert.equal(written.gate.passed, true);
      assert.ok(logs.some(message => message.includes('Scenario deltas:')));
      assert.ok(logs.some(message => message.includes('Compare report:')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('sets exit code 2 and records violations when gate fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-compare-'));
    try {
      const baselineDir = path.join(root, 'baseline');
      const candidateDir = path.join(root, 'candidate');
      fs.mkdirSync(baselineDir, { recursive: true });
      fs.mkdirSync(candidateDir, { recursive: true });

      fs.writeFileSync(path.join(baselineDir, 'results.json'), JSON.stringify([
        createCompareRunResult({ durationMs: 100 })
      ], null, 2), 'utf8');
      fs.writeFileSync(path.join(candidateDir, 'results.json'), JSON.stringify([
        createCompareRunResult({ durationMs: 180 })
      ], null, 2), 'utf8');

      const exitCodes: number[] = [];
      const logs: string[] = [];
      const result = await runCompare({
        ...parseCompareArgs(['--baseline', baselineDir, '--candidate', candidateDir, '--gate']),
        maxLatencyMultiplier: 1.2
      }, {
        now: () => '2026-03-17T12:00:00.000Z',
        log: message => logs.push(message),
        setExitCode: code => exitCodes.push(code)
      });

      assert.equal(result.report.gate.passed, false);
      assert.ok(result.report.gate.violations.some(v => v.metric === 'latencyMultiplier'));
      assert.deepEqual(exitCodes, [2]);
      assert.ok(logs.some(message => message.includes('Gate: FAIL')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
