import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildCheckpointReport,
  computeConfidenceInterval95,
  parseBenchmarkManifest,
  updateCheckpointRegistry
} from '../scripts/botEvalCheckpointManager';

function writeJson(filePath: string, value: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function createComparableRun(params: {
  root: string;
  dirName: string;
  gatePassed: boolean;
  summary: any[];
  baselineDir?: string;
}): string {
  const dirPath = path.join(params.root, params.dirName);
  fs.mkdirSync(dirPath, { recursive: true });
  writeJson(path.join(dirPath, 'summary.json'), params.summary);
  writeJson(path.join(dirPath, 'compare.json'), {
    baselineDir: params.baselineDir || 'projects/bot_eval_run/stable_baseline',
    gate: { passed: params.gatePassed }
  });
  return dirPath;
}

describe('botEvalCheckpointManager', () => {
  it('parses benchmark manifest with split taxonomy and policy', () => {
    const manifest = parseBenchmarkManifest({
      version: 2,
      scenarios: {
        'node-api-oracle': {
          splits: ['validation', 'test'],
          domains: ['node'],
          capabilities: ['api-design'],
          blocking: true
        }
      },
      checkpointPolicy: {
        minRunsInWindow: 4,
        gateRequired: true,
        requiredSplits: ['validation', 'test'],
        minPassRate: 1,
        minRawRunPassRate: 1,
        maxFallbackDependencyRunRate: 0.2
      }
    });

    assert.equal(manifest.version, 2);
    assert.deepEqual(manifest.scenarios['node-api-oracle'].splits, ['validation', 'test']);
    assert.deepEqual(manifest.checkpointPolicy.requiredSplits, ['validation', 'test']);
  });

  it('computes a finite 95% confidence interval', () => {
    const interval = computeConfidenceInterval95([1, 0.9, 1, 1, 0.95]);
    assert.ok(interval.low <= interval.high);
    assert.ok(interval.high <= 1.1);
  });

  it('builds split rollups and qualifies the latest checkpoint', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-checkpoint-'));
    try {
      const manifestPath = path.join(tmp, 'botEvalBenchmarks.json');
      writeJson(manifestPath, {
        version: 1,
        scenarios: {
          'ts-todo-oracle': {
            splits: ['train'],
            domains: ['typescript'],
            capabilities: ['editing'],
            blocking: true
          },
          'node-api-oracle': {
            splits: ['validation', 'test'],
            domains: ['node'],
            capabilities: ['integration'],
            blocking: true
          },
          'python-ai-stdlib-oracle': {
            splits: ['regression'],
            domains: ['python'],
            capabilities: ['tests'],
            blocking: true
          },
          'node-project-api-large': {
            splits: ['holdout'],
            domains: ['node'],
            capabilities: ['architecture'],
            blocking: false
          }
        },
        checkpointPolicy: {
          minRunsInWindow: 3,
          gateRequired: true,
          requiredSplits: ['validation', 'test', 'regression'],
          minPassRate: 1,
          minRawRunPassRate: 1,
          maxFallbackDependencyRunRate: 0.2
        }
      });

      createComparableRun({
        root: tmp,
        dirName: 'release_gate_ci_nightly_1001_1',
        gatePassed: true,
        summary: [
          { scenario: 'ts-todo-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 1100 },
          { scenario: 'node-api-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 1200 },
          { scenario: 'python-ai-stdlib-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 1000 }
        ]
      });
      createComparableRun({
        root: tmp,
        dirName: 'release_gate_ci_nightly_1002_1',
        gatePassed: true,
        summary: [
          { scenario: 'ts-todo-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 1000 },
          { scenario: 'node-api-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 1150 },
          { scenario: 'python-ai-stdlib-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 980 }
        ]
      });
      const latestRun = createComparableRun({
        root: tmp,
        dirName: 'release_gate_ci_nightly_1003_1',
        gatePassed: true,
        summary: [
          { scenario: 'ts-todo-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 900 },
          { scenario: 'node-api-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 1100 },
          { scenario: 'python-ai-stdlib-oracle', passRate: 1, rawRunPassRate: 1, fallbackDependencyRunRate: 0, avgMs: 950 }
        ]
      });

      const report = buildCheckpointReport({
        rootDir: tmp,
        manifestPath,
        window: 3
      });

      assert.equal(report.window, 3);
      assert.equal(report.checkpoint.qualified, true);
      assert.equal(report.checkpoint.latestRunDir, latestRun);
      assert.deepEqual(report.checkpoint.latestQualifiedScenarioIds, ['node-api-oracle', 'python-ai-stdlib-oracle']);

      const validationSplit = report.splitRollups.find(split => split.split === 'validation');
      assert.ok(validationSplit);
      assert.deepEqual(validationSplit?.scenariosSeen, ['node-api-oracle']);
      assert.equal(validationSplit?.missingScenarios.length, 0);
      assert.equal(validationSplit?.scenarioRollups[0].avgMs.mean, 1150);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('records and activates a qualified checkpoint in the registry', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-checkpoint-registry-'));
    try {
      const registryPath = path.join(tmp, 'checkpoint_registry.json');
      const updated = updateCheckpointRegistry(registryPath, {
        generatedAt: '2026-03-14T12:00:00.000Z',
        manifestVersion: 1,
        manifestPath: path.join(tmp, 'manifest.json'),
        rootDir: tmp,
        window: 3,
        inputs: [path.join(tmp, 'release_gate_ci_nightly_1003_1')],
        baselineDir: 'projects/bot_eval_run/stable_baseline',
        splitRollups: [],
        checkpoint: {
          qualified: true,
          reasons: [],
          latestRunDir: path.join(tmp, 'release_gate_ci_nightly_1003_1'),
          baselineDir: 'projects/bot_eval_run/stable_baseline',
          latestQualifiedScenarioIds: ['node-api-oracle']
        }
      }, true);

      assert.equal(updated.activeCheckpointId, 'release_gate_ci_nightly_1003_1@manifest-v1');
      assert.equal(updated.entries.length, 1);
      assert.equal(updated.entries[0].qualified, true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});