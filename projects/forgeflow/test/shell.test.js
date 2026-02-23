const test = require('node:test');
const assert = require('node:assert/strict');
const { runPipeline } = require('../dist/index.js');

test('shell.exec runs a command', async () => {
  const pipeline = {
    name: 'Shell',
    version: '1.0',
    tasks: [
      {
        id: 'echo',
        type: 'shell.exec',
        with: {
          command: process.execPath,
          args: ['-e', "console.log('hello')"]
        }
      }
    ]
  };

  const report = await runPipeline(pipeline, { cwd: process.cwd() });
  assert.equal(report.status, 'success');
  assert.ok(String(report.outputs.echo.stdout).includes('hello'));
});
