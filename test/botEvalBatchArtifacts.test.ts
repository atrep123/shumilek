import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { persistBatchArtifacts } from '../scripts/botEvalBatch';

describe('botEvalBatch artifact persistence', () => {
  it('writes top-level artifacts for partial failed batches', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-batch-artifacts-'));
    try {
      const batchOutDir = path.join(tmp, 'release_gate_1234');
      await persistBatchArtifacts({
        batchOutDir,
        meta: {
          batchId: 1234,
          scenarios: ['node-project-api-large'],
          runs: 5,
          outDir: batchOutDir
        },
        results: [
          {
            scenario: 'node-project-api-large',
            runIndex: 1,
            ok: false,
            exitCode: 1,
            durationMs: 1000,
            outDir: path.join(batchOutDir, 'node-project-api-large_run_01'),
            diagnostics: ['Command failed'],
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
          }
        ],
        summary: [
          {
            scenario: 'node-project-api-large',
            pass: 0,
            total: 1,
            passRate: 0,
            avgMs: 1000,
            runsWithPlannerError: 0,
            runsWithJsonRepairError: 0,
            jsonRepairErrorFiles: 0,
            runsWithSchemaFailure: 0,
            schemaFailures: 0,
            runsWithJsonParseFailure: 0,
            jsonParseFailures: 0,
            runsWithPlaceholderFailure: 0,
            placeholderFailures: 0,
            runsWithOtherParseFailure: 0,
            otherParseFailures: 0,
            runsWithDeterministicFallback: 0,
            deterministicFallbackActivations: 0,
            deterministicFallbackRecoveries: 0,
            deterministicFallbackTargetedActivations: 0,
            deterministicFallbackTargetedRecoveries: 0,
            deterministicFallbackCanonicalActivations: 0,
            deterministicFallbackCanonicalRecoveries: 0,
            rawPasses: 0,
            rawFailures: 1,
            rawPassRate: 0,
            recoveredByFallback: 0,
            fallbackDependencyRate: 0,
            runsWithRawPass: 0,
            runsRecoveredByFallback: 0,
            rawRunPassRate: 0,
            fallbackDependencyRunRate: 0,
            topFailureClusters: [{ id: 'command_runtime', count: 1 }]
          }
        ],
        infraRecoveryEvents: [],
        infraRestartEvents: [],
        infraAbort: null,
        totalPlannedRuns: 5,
        batchError: {
          name: 'Error',
          message: 'Synthetic batch failure',
          occurredAt: '2026-03-17T08:00:00.000Z'
        }
      });

      assert.equal(fs.existsSync(path.join(batchOutDir, 'meta.json')), true);
      assert.equal(fs.existsSync(path.join(batchOutDir, 'results.json')), true);
      assert.equal(fs.existsSync(path.join(batchOutDir, 'summary.json')), true);
      assert.equal(fs.existsSync(path.join(batchOutDir, 'batch_error.json')), true);

      const batchError = JSON.parse(fs.readFileSync(path.join(batchOutDir, 'batch_error.json'), 'utf8'));
      assert.equal(batchError.message, 'Synthetic batch failure');

      const results = JSON.parse(fs.readFileSync(path.join(batchOutDir, 'results.json'), 'utf8'));
      assert.equal(results.length, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});