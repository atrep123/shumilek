const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-ts-todo-'));
}

function parseJsonFromStdout(stdout) {
  const text = String(stdout || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error(`Expected JSON object on stdout, got: ${text.slice(0, 200)}`);
}

function runCli(workspaceDir, args) {
  const cliPath = path.join(workspaceDir, 'dist', 'cli.js');
  const res = spawnSync(process.execPath, [cliPath, ...args], { cwd: workspaceDir, encoding: 'utf8' });
  return { code: res.status ?? 1, stdout: res.stdout || '', stderr: res.stderr || '' };
}

test('TaskStore: CRUD persists to JSON file', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TaskStore } = require('../dist/store.js');
  assert.equal(typeof TaskStore, 'function');

  const dir = makeTempDir();
  const dataPath = path.join(dir, 'tasks.json');

  const store = new TaskStore(dataPath);
  assert.deepEqual(store.list(), []);

  const t1 = store.add('Buy milk');
  assert.equal(typeof t1.id, 'string');
  assert.ok(t1.id.length > 0);
  assert.equal(t1.title, 'Buy milk');
  assert.equal(t1.done, false);
  assert.equal(typeof t1.createdAt, 'string');
  assert.ok(fs.existsSync(dataPath));

  const listed = store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, t1.id);

  const done = store.done(t1.id);
  assert.equal(done.done, true);
  assert.equal(typeof done.doneAt, 'string');

  const removed = store.remove(t1.id);
  assert.equal(removed.id, t1.id);
  assert.deepEqual(store.list(), []);

  const persisted = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  assert.ok(persisted && typeof persisted === 'object');
  assert.ok(Array.isArray(persisted.tasks));
});

test('CLI: end-to-end flow', () => {
  const workspaceDir = path.join(__dirname, '..');
  const dir = makeTempDir();
  const dataPath = path.join(dir, 'tasks.json');

  // help
  const help = runCli(workspaceDir, ['--help']);
  assert.equal(help.code, 0, help.stderr || help.stdout);
  assert.ok((help.stdout + help.stderr).toLowerCase().includes('add'));

  // list empty
  const list0 = runCli(workspaceDir, ['list', '--data', dataPath]);
  assert.equal(list0.code, 0, list0.stderr || list0.stdout);
  const list0Json = parseJsonFromStdout(list0.stdout);
  assert.equal(list0Json.ok, true);
  assert.ok(Array.isArray(list0Json.tasks));
  assert.equal(list0Json.tasks.length, 0);

  // add
  const add = runCli(workspaceDir, ['add', 'Buy milk', '--data', dataPath]);
  assert.equal(add.code, 0, add.stderr || add.stdout);
  const addJson = parseJsonFromStdout(add.stdout);
  assert.equal(addJson.ok, true);
  assert.equal(addJson.task.title, 'Buy milk');
  assert.equal(addJson.task.done, false);
  assert.ok(fs.existsSync(dataPath));

  // list 1
  const list1 = runCli(workspaceDir, ['list', '--data', dataPath]);
  assert.equal(list1.code, 0, list1.stderr || list1.stdout);
  const list1Json = parseJsonFromStdout(list1.stdout);
  assert.equal(list1Json.ok, true);
  assert.equal(list1Json.tasks.length, 1);
  const id = String(list1Json.tasks[0].id);

  // done
  const done = runCli(workspaceDir, ['done', id, '--data', dataPath]);
  assert.equal(done.code, 0, done.stderr || done.stdout);
  const doneJson = parseJsonFromStdout(done.stdout);
  assert.equal(doneJson.ok, true);
  assert.equal(doneJson.task.done, true);

  // remove
  const rm = runCli(workspaceDir, ['remove', id, '--data', dataPath]);
  assert.equal(rm.code, 0, rm.stderr || rm.stdout);
  const rmJson = parseJsonFromStdout(rm.stdout);
  assert.equal(rmJson.ok, true);
  assert.equal(String(rmJson.task.id), id);

  const list2 = runCli(workspaceDir, ['list', '--data', dataPath]);
  const list2Json = parseJsonFromStdout(list2.stdout);
  assert.equal(list2Json.ok, true);
  assert.equal(list2Json.tasks.length, 0);
});

