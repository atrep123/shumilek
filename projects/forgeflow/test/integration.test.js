const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', chunk => {
        stdout += chunk.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });
    }

    child.on('error', err => {
      reject(err);
    });

    child.on('close', code => {
      resolve({ code: typeof code === 'number' ? code : -1, stdout, stderr });
    });
  });
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

test('end-to-end CLI and API flow', async () => {
  const cliValidate = await runCommand(
    process.execPath,
    ['dist/cli.js', 'validate', 'examples/sample.pipeline.json'],
    root
  );
  assert.equal(cliValidate.code, 0, cliValidate.stderr || cliValidate.stdout);

  const reportPath = path.join(root, 'reports', 'complex-run-int.json');
  const summaryPath = path.join(root, 'reports', 'complex-summary.txt');
  const mergedPath = path.join(root, 'reports', 'merged.json');
  const zipPath = path.join(root, 'reports', 'complex.zip');

  safeUnlink(reportPath);
  safeUnlink(summaryPath);
  safeUnlink(mergedPath);
  safeUnlink(zipPath);

  const cliRun = await runCommand(
    process.execPath,
    ['dist/cli.js', 'run', 'examples/complex.pipeline.json', '--report', reportPath],
    root
  );
  assert.equal(cliRun.code, 0, cliRun.stderr || cliRun.stdout);
  assert.equal(fs.existsSync(summaryPath), true, 'summary missing');
  assert.equal(fs.existsSync(mergedPath), true, 'merged.json missing');
  assert.equal(fs.existsSync(zipPath), true, 'zip missing');

  const runReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  assert.equal(runReport.status, 'success');

  const { startServer } = require('../dist/server.js');
  const server = await startServer(0);
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 7070;

  try {
    const payload = fs.readFileSync(path.join(root, 'examples', 'complex.pipeline.json'), 'utf-8');
    const validateRes = await fetch(`http://localhost:${port}/pipelines/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload
    });
    const validation = await validateRes.json();
    assert.equal(validation.valid, true);

    const runRes = await fetch(`http://localhost:${port}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload
    });
    const run = await runRes.json();
    assert.equal(run.status, 'success');
    assert.ok(run.runId);
  } finally {
    server.close();
  }
});
