import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { parseBatchArgs, persistBatchArtifacts, runBatch } from '../scripts/botEvalBatch';

function createRepoRoot(tmp: string): string {
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(repoRoot, 'node_modules', 'ts-node', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'node_modules', 'ts-node', 'dist', 'bin.js'), '', 'utf8');
  return repoRoot;
}

function createRunResult(params: {
  batchOutDir: string;
  scenario?: string;
  runIndex?: number;
  ok?: boolean;
  infraFailure?: {
    kind: 'ollama_unreachable' | 'ollama_model_missing';
    message: string;
    source: 'validation' | 'run_log';
  } | null;
}) {
  const scenario = params.scenario || 'node-project-api-large';
  const runIndex = params.runIndex || 1;
  return {
    scenario,
    runIndex,
    ok: params.ok ?? false,
    exitCode: params.ok ? 0 : 1,
    durationMs: 1000,
    outDir: path.join(params.batchOutDir, `${scenario}_run_${String(runIndex).padStart(2, '0')}`),
    diagnostics: params.ok ? [] : ['Command failed'],
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
    infraFailure: params.infraFailure ?? null
  };
}

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

  it('persists top-level artifacts before rethrowing an unexpected batch error', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-batch-run-'));
    try {
      const repoRoot = createRepoRoot(tmp);
      const batchOutDir = path.join(tmp, 'batch_2001');
      const opts = parseBatchArgs([
        '--scenario', 'node-project-api-large',
        '--runs', '2',
        '--outDir', batchOutDir
      ]);
      let callCount = 0;

      await assert.rejects(
        () => runBatch(opts, {
          repoRoot,
          runSingle: async () => {
            callCount += 1;
            if (callCount === 1) {
              return createRunResult({ batchOutDir, runIndex: 1 });
            }
            throw new Error('Synthetic runSingle crash');
          }
        }),
        /Synthetic runSingle crash/
      );

      assert.equal(fs.existsSync(path.join(batchOutDir, 'meta.json')), true);
      assert.equal(fs.existsSync(path.join(batchOutDir, 'results.json')), true);
      assert.equal(fs.existsSync(path.join(batchOutDir, 'summary.json')), true);
      assert.equal(fs.existsSync(path.join(batchOutDir, 'batch_error.json')), true);

      const results = JSON.parse(fs.readFileSync(path.join(batchOutDir, 'results.json'), 'utf8'));
      assert.equal(results.length, 1);
      const batchError = JSON.parse(fs.readFileSync(path.join(batchOutDir, 'batch_error.json'), 'utf8'));
      assert.equal(batchError.message, 'Synthetic runSingle crash');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('writes infra_abort.json and preserves partial results when batch stops on infra failure', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-batch-run-'));
    try {
      const repoRoot = createRepoRoot(tmp);
      const batchOutDir = path.join(tmp, 'batch_2002');
      const opts = parseBatchArgs([
        '--scenario', 'node-project-api-large',
        '--runs', '3',
        '--outDir', batchOutDir
      ]);

      const result = await runBatch(opts, {
        repoRoot,
        runSingle: async () => createRunResult({
          batchOutDir,
          runIndex: 1,
          infraFailure: {
            kind: 'ollama_unreachable',
            message: 'cannot reach ollama',
            source: 'validation'
          }
        })
      });

      assert.ok(result.infraAbort);
      assert.equal(result.results.length, 1);
      assert.equal(fs.existsSync(path.join(batchOutDir, 'infra_abort.json')), true);
      assert.equal(fs.existsSync(path.join(batchOutDir, 'results.json')), true);
      assert.equal(fs.existsSync(path.join(batchOutDir, 'summary.json')), true);

      const infraAbort = JSON.parse(fs.readFileSync(path.join(batchOutDir, 'infra_abort.json'), 'utf8'));
      assert.equal(infraAbort.kind, 'ollama_unreachable');
      assert.equal(infraAbort.plannedRuns, 3);
      assert.equal(infraAbort.executedRuns, 1);
      assert.equal(infraAbort.skippedRuns, 2);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
