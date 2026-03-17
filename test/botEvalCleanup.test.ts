import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  parseCleanupArgs,
  runCleanup
} from '../scripts/botEvalCleanup';

function createDir(root: string, name: string, mtimeMs: number): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const when = new Date(mtimeMs);
  fs.utimesSync(dir, when, when);
  return dir;
}

describe('botEvalCleanup', () => {
  it('parses explicit root, policy, dryRun, and out path', () => {
    const opts = parseCleanupArgs([
      '--root', 'custom-root',
      '--policy', 'run_:5',
      '--policy', 'batch_:3',
      '--dryRun',
      '--out', 'cleanup.json'
    ]);

    assert.equal(opts.root, path.resolve('custom-root'));
    assert.deepEqual(opts.policies, [
      { prefix: 'run_', keep: 5 },
      { prefix: 'batch_', keep: 3 }
    ]);
    assert.equal(opts.dryRun, true);
    assert.equal(opts.outPath, path.resolve('cleanup.json'));
  });

  it('reports missing root and returns null', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-cleanup-'));
    try {
      const root = path.join(tmp, 'missing-root');
      const logs: string[] = [];
      const report = await runCleanup({
        root,
        policies: [{ prefix: 'run_', keep: 1 }],
        dryRun: false
      }, {
        log: message => logs.push(message)
      });

      assert.equal(report, null);
      assert.ok(logs.some(message => message.includes(`Cleanup root does not exist: ${root}`)));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('keeps newest matching directories on dryRun and writes report without deleting', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-cleanup-'));
    try {
      const root = path.join(tmp, 'runs');
      fs.mkdirSync(root, { recursive: true });
      createDir(root, 'run_old', 1_000);
      createDir(root, 'run_mid', 2_000);
      createDir(root, 'run_new', 3_000);
      createDir(root, 'batch_keep', 4_000);
      const outPath = path.join(tmp, 'cleanup-report.json');

      const report = await runCleanup({
        root,
        policies: [{ prefix: 'run_', keep: 2 }],
        dryRun: true,
        outPath
      }, {
        now: () => '2026-03-17T12:00:00.000Z',
        log: () => undefined
      });

      assert.ok(report);
      assert.equal(report?.generatedAt, '2026-03-17T12:00:00.000Z');
      assert.equal(report?.results.length, 1);
      assert.deepEqual(report?.results[0]?.kept, ['run_new', 'run_mid']);
      assert.deepEqual(report?.results[0]?.deleted, ['run_old']);
      assert.ok(fs.existsSync(path.join(root, 'run_old')));
      assert.ok(fs.existsSync(outPath));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('deletes only directories beyond keep limit for each policy', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-cleanup-'));
    try {
      const root = path.join(tmp, 'runs');
      fs.mkdirSync(root, { recursive: true });
      createDir(root, 'run_a', 1_000);
      createDir(root, 'run_b', 2_000);
      createDir(root, 'run_c', 3_000);
      createDir(root, 'batch_a', 4_000);
      createDir(root, 'batch_b', 5_000);

      const report = await runCleanup({
        root,
        policies: [
          { prefix: 'run_', keep: 1 },
          { prefix: 'batch_', keep: 1 }
        ],
        dryRun: false
      }, {
        now: () => '2026-03-17T12:00:00.000Z',
        log: () => undefined
      });

      assert.ok(report);
      assert.deepEqual(report?.results[0]?.kept, ['run_c']);
      assert.deepEqual(report?.results[0]?.deleted, ['run_b', 'run_a']);
      assert.deepEqual(report?.results[1]?.kept, ['batch_b']);
      assert.deepEqual(report?.results[1]?.deleted, ['batch_a']);
      assert.ok(!fs.existsSync(path.join(root, 'run_a')));
      assert.ok(!fs.existsSync(path.join(root, 'run_b')));
      assert.ok(fs.existsSync(path.join(root, 'run_c')));
      assert.ok(!fs.existsSync(path.join(root, 'batch_a')));
      assert.ok(fs.existsSync(path.join(root, 'batch_b')));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});