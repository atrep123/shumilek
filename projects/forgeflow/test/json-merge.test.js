const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runPipeline } = require('../dist/index.js');

test('json.merge combines sources and writes destination', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeflow-merge-'));
  const aPath = path.join(tmpDir, 'a.json');
  const bPath = path.join(tmpDir, 'b.json');
  fs.writeFileSync(aPath, JSON.stringify({ arr: [1], value: { a: 1 } }, null, 2));
  fs.writeFileSync(bPath, JSON.stringify({ arr: [2], value: { b: 2 } }, null, 2));

  const pipeline = {
    name: 'Merge',
    version: '1.0',
    tasks: [
      {
        id: 'merge',
        type: 'json.merge',
        with: {
          sources: [aPath, bPath, { extra: true }],
          destination: 'out.json',
          arrayMode: 'concat'
        }
      }
    ]
  };

  const report = await runPipeline(pipeline, { cwd: tmpDir });
  assert.equal(report.status, 'success');

  const merged = JSON.parse(fs.readFileSync(path.join(tmpDir, 'out.json'), 'utf-8'));
  assert.deepEqual(merged.arr, [1, 2]);
  assert.deepEqual(merged.value, { a: 1, b: 2 });
  assert.equal(merged.extra, true);
});
