const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const request = require('supertest');

async function loadApp() {
  const candidates = [
    '../src/app.js',
    '../src/app.cjs',
    '../src/app.mjs',
    '../dist/app.js',
    '../build/app.js',
    '../src/app.ts',
  ];

  const errors = [];
  for (const rel of candidates) {
    const abs = path.join(__dirname, rel);
    if (!fs.existsSync(abs)) continue;

    try {
      let mod;
      if (rel.endsWith('.mjs')) {
        mod = await import(pathToFileURL(abs).href);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        mod = require(abs);
      }
      const app = mod?.app || mod?.default || mod;
      if (typeof app === 'function') return app;
      errors.push(`${rel}: module loaded, but app export is not a function`);
    } catch (err) {
      errors.push(`${rel}: ${String(err?.message || err)}`);
    }
  }

  throw new Error(`Expected app export in src/app.* (or dist/build). Details: ${errors.join(' | ') || 'no candidate app file found'}`);
}

function expectErrorPayload(res, expectedStatus) {
  assert.equal(res.status, expectedStatus, res.text);
  assert.ok(res.body && typeof res.body === 'object', 'Expected JSON object body');
  assert.ok(res.body.error && typeof res.body.error === 'object', 'Expected error object');
  assert.equal(typeof res.body.error.code, 'string');
  assert.ok(res.body.error.code.length > 0);
  assert.equal(typeof res.body.error.message, 'string');
  assert.ok(res.body.error.message.length > 0);
}

test('health + empty project list', async () => {
  const app = await loadApp();

  const health = await request(app).get('/health');
  assert.equal(health.status, 200, health.text);
  assert.equal(health.body?.ok, true);

  const list = await request(app).get('/projects');
  assert.equal(list.status, 200, list.text);
  assert.ok(Array.isArray(list.body?.projects));
  assert.equal(list.body.projects.length, 0);
});

test('project create/list/get + duplicate + validation', async () => {
  const app = await loadApp();

  const badCreate = await request(app).post('/projects').send({});
  expectErrorPayload(badCreate, 400);

  const created = await request(app).post('/projects').send({ name: 'Alpha' });
  assert.equal(created.status, 201, created.text);
  assert.ok(created.body?.project);
  assert.equal(typeof created.body.project.id, 'string');
  assert.ok(created.body.project.id.length > 0);
  assert.equal(created.body.project.name, 'Alpha');

  const list = await request(app).get('/projects');
  assert.equal(list.status, 200, list.text);
  assert.ok(Array.isArray(list.body?.projects));
  assert.equal(list.body.projects.length, 1);
  assert.equal(String(list.body.projects[0].id), String(created.body.project.id));

  const getOne = await request(app).get(`/projects/${encodeURIComponent(created.body.project.id)}`);
  assert.equal(getOne.status, 200, getOne.text);
  assert.equal(String(getOne.body?.project?.id), String(created.body.project.id));

  const duplicate = await request(app).post('/projects').send({ name: 'Alpha' });
  expectErrorPayload(duplicate, 409);
});

test('members endpoints', async () => {
  const app = await loadApp();

  const created = await request(app).post('/projects').send({ name: 'Members Project' });
  assert.equal(created.status, 201, created.text);
  const projectId = String(created.body.project.id);

  const badMember = await request(app)
    .post(`/projects/${encodeURIComponent(projectId)}/members`)
    .send({ userId: '', role: 'owner' });
  expectErrorPayload(badMember, 400);

  const added = await request(app)
    .post(`/projects/${encodeURIComponent(projectId)}/members`)
    .send({ userId: 'u-1', role: 'owner' });
  assert.equal(added.status, 201, added.text);
  assert.equal(String(added.body?.member?.userId), 'u-1');
  assert.equal(String(added.body?.member?.role), 'owner');

  const duplicate = await request(app)
    .post(`/projects/${encodeURIComponent(projectId)}/members`)
    .send({ userId: 'u-1', role: 'owner' });
  expectErrorPayload(duplicate, 409);

  const list = await request(app).get(`/projects/${encodeURIComponent(projectId)}/members`);
  assert.equal(list.status, 200, list.text);
  assert.ok(Array.isArray(list.body?.members));
  assert.equal(list.body.members.length, 1);
});

test('tasks create/list/filter + patch status', async () => {
  const app = await loadApp();

  const created = await request(app).post('/projects').send({ name: 'Tasks Project' });
  assert.equal(created.status, 201, created.text);
  const projectId = String(created.body.project.id);

  const t1 = await request(app)
    .post(`/projects/${encodeURIComponent(projectId)}/tasks`)
    .send({ title: 'Prepare spec' });
  assert.equal(t1.status, 201, t1.text);
  const taskId = String(t1.body?.task?.id);
  assert.ok(taskId.length > 0);
  assert.equal(t1.body?.task?.title, 'Prepare spec');

  const t2 = await request(app)
    .post(`/projects/${encodeURIComponent(projectId)}/tasks`)
    .send({ title: 'Ship release' });
  assert.equal(t2.status, 201, t2.text);

  const listAll = await request(app).get(`/projects/${encodeURIComponent(projectId)}/tasks`);
  assert.equal(listAll.status, 200, listAll.text);
  assert.ok(Array.isArray(listAll.body?.tasks));
  assert.equal(listAll.body.tasks.length, 2);

  const patchDone = await request(app)
    .patch(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`)
    .send({ status: 'done' });
  assert.equal(patchDone.status, 200, patchDone.text);
  assert.equal(String(patchDone.body?.task?.status), 'done');

  const listDone = await request(app).get(`/projects/${encodeURIComponent(projectId)}/tasks?status=done`);
  assert.equal(listDone.status, 200, listDone.text);
  assert.ok(Array.isArray(listDone.body?.tasks));
  assert.equal(listDone.body.tasks.length, 1);
  assert.equal(String(listDone.body.tasks[0].id), taskId);
});

test('comments + not-found and payload contract', async () => {
  const app = await loadApp();

  const created = await request(app).post('/projects').send({ name: 'Comments Project' });
  assert.equal(created.status, 201, created.text);
  const projectId = String(created.body.project.id);

  const task = await request(app)
    .post(`/projects/${encodeURIComponent(projectId)}/tasks`)
    .send({ title: 'Document API' });
  assert.equal(task.status, 201, task.text);
  const taskId = String(task.body.task.id);

  const badComment = await request(app)
    .post(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments`)
    .send({});
  expectErrorPayload(badComment, 400);

  const comment = await request(app)
    .post(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments`)
    .send({ message: 'Looks good' });
  assert.equal(comment.status, 201, comment.text);
  assert.equal(String(comment.body?.comment?.message), 'Looks good');

  const commentList = await request(app)
    .get(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments`);
  assert.equal(commentList.status, 200, commentList.text);
  assert.ok(Array.isArray(commentList.body?.comments));
  assert.equal(commentList.body.comments.length, 1);

  const missingProject = await request(app).get('/projects/does-not-exist');
  expectErrorPayload(missingProject, 404);

  const missingTask = await request(app)
    .patch(`/projects/${encodeURIComponent(projectId)}/tasks/does-not-exist`)
    .send({ status: 'done' });
  expectErrorPayload(missingTask, 404);
});
