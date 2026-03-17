import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  parseReleaseGateArgs,
  runReleaseGate,
  resolveReleaseGateBaselineDir,
} from '../scripts/botEvalReleaseGate';

describe('botEvalReleaseGate baseline pointer helpers', () => {
  it('parses baseline pointer and lock flag', () => {
    const opts = parseReleaseGateArgs([
      '--baselinePointer', 'projects/bot_eval_run/release_baseline.txt',
      '--lockBaseline',
      '--runs', '5',
      '--maxIterations', '9'
    ]);
    assert.equal(opts.baselinePointerPath, 'projects/bot_eval_run/release_baseline.txt');
    assert.equal(opts.lockBaseline, true);
    assert.equal(opts.runs, 5);
    assert.equal(opts.maxIterations, 9);
  });

  it('falls back to default scenarios when explicit list is empty', () => {
    const opts = parseReleaseGateArgs(['--scenarios', ',']);
    assert.deepEqual(opts.scenarios, ['ts-todo-oracle', 'node-api-oracle', 'ts-csv-oracle', 'python-ai-stdlib-oracle', 'node-project-api-large']);
  });

  it('prefers explicit baseline over pointer file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-release-gate-'));
    const pointerPath = path.join(tempDir, 'release_baseline.txt');
    const pointerTarget = path.join(tempDir, 'pointer_batch');
    const cliTarget = path.join(tempDir, 'cli_batch');
    fs.writeFileSync(pointerPath, pointerTarget + '\n', 'utf8');

    const resolved = resolveReleaseGateBaselineDir({
      baselineDir: cliTarget,
      baselinePointerPath: pointerPath
    });
    assert.equal(resolved, path.resolve(cliTarget));
  });

  it('uses baseline pointer when explicit baseline is missing', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-release-gate-'));
    const pointerPath = path.join(tempDir, 'release_baseline.txt');
    const pointerTarget = path.join(tempDir, 'pointer_batch');
    fs.writeFileSync(pointerPath, pointerTarget + '\n', 'utf8');

    const resolved = resolveReleaseGateBaselineDir({
      baselinePointerPath: pointerPath
    });
    assert.equal(resolved, path.resolve(pointerTarget));
  });

  it('throws clear error when neither baseline nor pointer is available', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-release-gate-'));
    const pointerPath = path.join(tempDir, 'missing_release_baseline.txt');
    assert.throws(
      () => resolveReleaseGateBaselineDir({ baselinePointerPath: pointerPath }),
      /Baseline not provided/i
    );
  });
});

describe('botEvalReleaseGate orchestration', () => {
  function createRepoRoot(): {
    repoRoot: string;
    baselineDir: string;
    baselinePointerPath: string;
    tsNodePath: string;
  } {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-release-gate-repo-'));
    const baselineDir = path.join(repoRoot, 'projects', 'bot_eval_run', 'stable');
    const baselinePointerPath = path.join(repoRoot, 'projects', 'bot_eval_run', 'release_baseline.txt');
    const tsNodePath = path.join(repoRoot, 'node_modules', 'ts-node', 'dist', 'bin.js');
    fs.mkdirSync(path.dirname(tsNodePath), { recursive: true });
    fs.writeFileSync(tsNodePath, '', 'utf8');
    fs.mkdirSync(baselineDir, { recursive: true });
    fs.writeFileSync(path.join(baselineDir, 'results.json'), JSON.stringify({ ok: true }), 'utf8');
    return { repoRoot, baselineDir, baselinePointerPath, tsNodePath };
  }

  it('locks baseline pointer only after successful batch and compare', async () => {
    const { repoRoot, baselineDir, baselinePointerPath, tsNodePath } = createRepoRoot();
    const compareOut = path.join(repoRoot, 'compare.json');
    const candidateDir = path.join(repoRoot, 'projects', 'bot_eval_run', 'release_gate_candidate');
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const exitCodes: number[] = [];
    const result = await runReleaseGate(
      {
        ...parseReleaseGateArgs(['--lockBaseline']),
        baselineDir,
        baselinePointerPath,
        outDir: candidateDir,
        compareOut,
        gateConfigPath: 'scripts/config/botEvalGate.ci.json'
      },
      {
        repoRoot,
        tsNodePath,
        runNodeCommand: async (args, cwd) => {
          calls.push({ args, cwd });
          return 0;
        },
        setExitCode: code => exitCodes.push(code)
      }
    );

    assert.equal(result.baselineDir, path.resolve(baselineDir));
    assert.equal(result.candidateDir, path.resolve(candidateDir));
    assert.equal(result.batchCode, 0);
    assert.equal(result.compareCode, 0);
    assert.equal(result.baselinePointerUpdated, true);
    assert.deepEqual(exitCodes, []);
    assert.equal(calls.length, 2);
    assert.match(calls[0].args[1] || '', /botEvalBatch\.ts$/);
    assert.match(calls[1].args[1] || '', /botEvalCompare\.ts$/);
    assert.ok(calls[1].args.includes('--gateConfig'));
    assert.ok(calls[1].args.includes('scripts/config/botEvalGate.ci.json'));
    assert.ok(calls[1].args.includes('--out'));
    assert.ok(calls[1].args.includes(compareOut));
    assert.equal(fs.readFileSync(baselinePointerPath, 'utf8').trim(), path.resolve(candidateDir));
  });

  it('stops after batch failure without compare or baseline lock', async () => {
    const { repoRoot, baselineDir, baselinePointerPath, tsNodePath } = createRepoRoot();
    const pointerTarget = path.join(repoRoot, 'projects', 'bot_eval_run', 'existing_baseline');
    fs.writeFileSync(baselinePointerPath, pointerTarget + '\n', 'utf8');
    const exitCodes: number[] = [];
    const calls: string[][] = [];

    const result = await runReleaseGate(
      {
        ...parseReleaseGateArgs(['--lockBaseline']),
        baselineDir,
        baselinePointerPath,
        outDir: path.join(repoRoot, 'projects', 'bot_eval_run', 'release_gate_candidate')
      },
      {
        repoRoot,
        tsNodePath,
        runNodeCommand: async args => {
          calls.push(args);
          return 23;
        },
        setExitCode: code => exitCodes.push(code)
      }
    );

    assert.equal(result.batchCode, 23);
    assert.equal(result.compareCode, undefined);
    assert.equal(result.baselinePointerUpdated, false);
    assert.equal(calls.length, 1);
    assert.deepEqual(exitCodes, [23]);
    assert.equal(fs.readFileSync(baselinePointerPath, 'utf8').trim(), pointerTarget);
  });

  it('stops after compare failure without updating baseline pointer', async () => {
    const { repoRoot, baselineDir, baselinePointerPath, tsNodePath } = createRepoRoot();
    const pointerTarget = path.join(repoRoot, 'projects', 'bot_eval_run', 'existing_baseline');
    fs.writeFileSync(baselinePointerPath, pointerTarget + '\n', 'utf8');
    const exitCodes: number[] = [];
    const calls: string[][] = [];

    const result = await runReleaseGate(
      {
        ...parseReleaseGateArgs(['--lockBaseline']),
        baselineDir,
        baselinePointerPath,
        outDir: path.join(repoRoot, 'projects', 'bot_eval_run', 'release_gate_candidate')
      },
      {
        repoRoot,
        tsNodePath,
        runNodeCommand: async args => {
          calls.push(args);
          return calls.length === 1 ? 0 : 19;
        },
        setExitCode: code => exitCodes.push(code)
      }
    );

    assert.equal(result.batchCode, 0);
    assert.equal(result.compareCode, 19);
    assert.equal(result.baselinePointerUpdated, false);
    assert.equal(calls.length, 2);
    assert.deepEqual(exitCodes, [19]);
    assert.equal(fs.readFileSync(baselinePointerPath, 'utf8').trim(), pointerTarget);
  });
});

