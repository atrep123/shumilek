const mock = require('mock-require');
const { strict: assert } = require('assert');

const { vscodeMock } = require('./helpers/vscodeMockShared');

function loadPostEditVerification() {
  mock.stopAll();
  mock('vscode', vscodeMock);
  return mock.reRequire('../src/postEditVerification');
}

function asBytes(text) {
  return Buffer.from(text, 'utf8');
}

describe('postEditVerification', () => {
  afterEach(() => {
    mock.stopAll();
  });

  it('returns successful command result for a passing exec call', async () => {
    const { runVerificationCommand } = loadPostEditVerification();
    const result = await runVerificationCommand(
      'npm run -s lint',
      'C:/repo',
      1000,
      ((command, _options, callback) => {
        callback(null, 'ok stdout', '');
        return {};
      })
    );

    assert.deepEqual(result, {
      command: 'npm run -s lint',
      ok: true,
      exitCode: 0,
      stdout: 'ok stdout',
      stderr: ''
    });
  });

  it('returns empty success when there is no workspace or package.json', async () => {
    const { runPostEditVerification } = loadPostEditVerification();

    const noWorkspace = await runPostEditVerification(1000, { workspaceFolders: [] });
    assert.deepEqual(noWorkspace, { ok: true, ran: [], failed: [] });

    const missingPackage = await runPostEditVerification(1000, {
      workspaceFolders: [{ uri: { fsPath: 'C:/repo' } }],
      joinPath: (_base, ...segments) => ({ fsPath: `C:/repo/${segments.join('/')}` }),
      readFile: async () => { throw new Error('missing'); }
    });
    assert.deepEqual(missingPackage, { ok: true, ran: [], failed: [] });
  });

  it('runs lint, test, and build in order and stops on first failure', async () => {
    const commands = [];
    const { runPostEditVerification } = loadPostEditVerification();

    const summary = await runPostEditVerification(2000, {
      workspaceFolders: [{ uri: { fsPath: 'C:/repo' } }],
      joinPath: (_base, ...segments) => ({ fsPath: `C:/repo/${segments.join('/')}` }),
      readFile: async () => asBytes(JSON.stringify({
        scripts: {
          lint: 'eslint .',
          test: 'mocha',
          build: 'tsc -p .'
        }
      })),
      exec: ((command, _options, callback) => {
        commands.push(command);
        if (command === 'npm run -s test') {
          const error = new Error('failed');
          error.code = 2;
          callback(error, 'partial', 'boom');
          return {};
        }
        callback(null, `${command} ok`, '');
        return {};
      })
    });

    assert.deepEqual(commands, ['npm run -s lint', 'npm run -s test']);
    assert.equal(summary.ok, false);
    assert.equal(summary.ran.length, 2);
    assert.equal(summary.failed.length, 1);
    assert.equal(summary.failed[0].command, 'npm run -s test');
    assert.equal(summary.failed[0].exitCode, 2);
    assert.equal(summary.failed[0].stderr, 'boom');
  });

  it('ignores missing scripts and caps execution to the known lint/test/build commands', async () => {
    const commands = [];
    const { runPostEditVerification } = loadPostEditVerification();

    const summary = await runPostEditVerification(2000, {
      workspaceFolders: [{ uri: { fsPath: 'C:/repo' } }],
      joinPath: (_base, ...segments) => ({ fsPath: `C:/repo/${segments.join('/')}` }),
      readFile: async () => asBytes(JSON.stringify({
        scripts: {
          test: 'mocha',
          build: 'tsc -p .',
          start: 'node server.js'
        }
      })),
      exec: ((command, _options, callback) => {
        commands.push(command);
        callback(null, 'ok', '');
        return {};
      })
    });

    assert.deepEqual(commands, ['npm run -s test', 'npm run -s build']);
    assert.equal(summary.ok, true);
    assert.equal(summary.failed.length, 0);
  });
});