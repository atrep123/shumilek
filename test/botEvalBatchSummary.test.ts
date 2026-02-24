import { strict as assert } from 'assert';

import { summarize } from '../scripts/botEvalBatch';

describe('botEvalBatch summary metrics', () => {
  it('aggregates raw-vs-recovered fallback metrics', () => {
    const results: any[] = [
      {
        scenario: 'node-api-oracle',
        runIndex: 1,
        ok: true,
        exitCode: 0,
        durationMs: 1000,
        outDir: 'x',
        diagnostics: [],
        timedOut: false,
        parseStats: {
          plannerFailures: 0,
          schemaFailures: 0,
          jsonRepairFailures: 0,
          parseFailures: 0
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
            recoveries: 1,
            targetedActivations: 1,
            targetedRecoveries: 1,
            canonicalActivations: 0,
            canonicalRecoveries: 0,
            rawPasses: 0,
            rawFailures: 1,
            recoveredByFallback: 1
          },
          totalActivations: 1,
          totalRecoveries: 1,
          totalTargetedActivations: 1,
          totalTargetedRecoveries: 1,
          totalCanonicalActivations: 0,
          totalCanonicalRecoveries: 0,
          totalRawPasses: 0,
          totalRawFailures: 1,
          totalRecoveredByFallback: 1,
          fallbackDependencyRate: 1
        }
      },
      {
        scenario: 'node-api-oracle',
        runIndex: 2,
        ok: true,
        exitCode: 0,
        durationMs: 800,
        outDir: 'y',
        diagnostics: [],
        timedOut: false,
        parseStats: {
          plannerFailures: 0,
          schemaFailures: 0,
          jsonRepairFailures: 0,
          parseFailures: 0
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
            activations: 0,
            recoveries: 0,
            targetedActivations: 0,
            targetedRecoveries: 0,
            canonicalActivations: 0,
            canonicalRecoveries: 0,
            rawPasses: 1,
            rawFailures: 0,
            recoveredByFallback: 0
          },
          totalActivations: 0,
          totalRecoveries: 0,
          totalTargetedActivations: 0,
          totalTargetedRecoveries: 0,
          totalCanonicalActivations: 0,
          totalCanonicalRecoveries: 0,
          totalRawPasses: 1,
          totalRawFailures: 0,
          totalRecoveredByFallback: 0,
          fallbackDependencyRate: 0
        }
      }
    ];

    const summary = summarize(results);
    assert.equal(summary.length, 1);
    const row: any = summary[0];
    assert.equal(row.scenario, 'node-api-oracle');
    assert.equal(row.deterministicFallbackActivations, 1);
    assert.equal(row.deterministicFallbackTargetedActivations, 1);
    assert.equal(row.deterministicFallbackCanonicalActivations, 0);
    assert.equal(row.rawPasses, 1);
    assert.equal(row.rawFailures, 1);
    assert.equal(row.recoveredByFallback, 1);
    assert.equal(row.rawPassRate, 0.5);
    assert.equal(row.fallbackDependencyRate, 0.5);
    assert.equal(row.jsonParseFailures, 0);
    assert.equal(row.placeholderFailures, 0);
    assert.equal(row.otherParseFailures, 0);
    assert.ok(Array.isArray(row.topFailureClusters));
    assert.equal(row.topFailureClusters.length, 0);
  });

  it('derives raw metrics from final outcome for scenarios without explicit raw instrumentation', () => {
    const results: any[] = [
      {
        scenario: 'python-ai-stdlib-oracle',
        runIndex: 1,
        ok: true,
        exitCode: 0,
        durationMs: 900,
        outDir: 'p1',
        diagnostics: [],
        timedOut: false,
        parseStats: {
          plannerFailures: 0,
          schemaFailures: 0,
          jsonRepairFailures: 0,
          parseFailures: 0
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
        }
      },
      {
        scenario: 'python-ai-stdlib-oracle',
        runIndex: 2,
        ok: false,
        exitCode: 2,
        durationMs: 1100,
        outDir: 'p2',
        diagnostics: ['Validation failed'],
        timedOut: false,
        parseStats: {
          plannerFailures: 0,
          schemaFailures: 0,
          jsonRepairFailures: 0,
          parseFailures: 0
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
        }
      }
    ];

    const summary = summarize(results);
    assert.equal(summary.length, 1);
    const row: any = summary[0];
    assert.equal(row.scenario, 'python-ai-stdlib-oracle');
    assert.equal(row.rawPasses, 1);
    assert.equal(row.rawFailures, 1);
    assert.equal(row.rawPassRate, 0.5);
    assert.equal(row.recoveredByFallback, 0);
    assert.equal(row.fallbackDependencyRate, 0);
    assert.equal(row.runsWithRawPass, 1);
    assert.equal(row.runsRecoveredByFallback, 0);
    assert.equal(row.rawRunPassRate, 0.5);
    assert.equal(row.fallbackDependencyRunRate, 0);
  });
});
