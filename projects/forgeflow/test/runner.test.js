const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runPipeline } = require('../dist/index.js');

test('runPipeline executes tasks and writes output', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeflow-'));
  const pipeline = {
    name: 'Run',
    version: '1.0',
    env: { projectRoot: tmpDir },
    settings: { maxConcurrency: 2, failFast: true },
    tasks: [
      {
        id: 'make',
        type: 'transform',
        with: { template: 'hello' }
      },
      {
        id: 'write',
        type: 'file.write',
        dependsOn: ['make'],
        with: {
          path: '{{env.projectRoot}}/out.txt',
          content: '{{tasks.make.result}}'
        }
      }
    ]
  };

  const report = await runPipeline(pipeline, { cwd: tmpDir });
  assert.equal(report.status, 'success');
  const output = fs.readFileSync(path.join(tmpDir, 'out.txt'), 'utf-8');
  assert.equal(output, 'hello');
});
