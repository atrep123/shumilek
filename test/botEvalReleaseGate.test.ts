import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  parseReleaseGateArgs,
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
    assert.deepEqual(opts.scenarios, ['ts-todo-oracle', 'node-api-oracle', 'python-ai-stdlib-oracle']);
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

