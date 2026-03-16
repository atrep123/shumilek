import { strict as assert } from 'assert';

import {
  classifyFailureCluster,
  collectFailureClustersForRun,
} from '../scripts/botEvalBatch';
import { compareSummaries, evaluateAcceptanceGate } from '../scripts/botEvalCompare';

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
});
