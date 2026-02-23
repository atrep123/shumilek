const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readTodos(dataPath) {
  try {
    const raw = fs.readFileSync(dataPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.todos) ? parsed.todos : [];
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function writeTodos(dataPath, todos) {
  fs.writeFileSync(dataPath, JSON.stringify({ todos }, null, 2), 'utf8');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += String(chunk);
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseId(pathname) {
  const m = pathname.match(/^\/todos\/([^/]+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

function createServer({ dataPath }) {
  return http.createServer(async (req, res) => {
    try {
      const method = String(req.method || 'GET').toUpperCase();
      const url = new URL(String(req.url || '/'), 'http://127.0.0.1');
      const pathname = url.pathname;

      if (method === 'GET' && pathname === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'GET' && pathname === '/openapi.json') {
        const specPath = path.join(__dirname, '..', 'openapi.json');
        const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
        sendJson(res, 200, spec);
        return;
      }

      if (method === 'GET' && pathname === '/todos') {
        sendJson(res, 200, { ok: true, todos: readTodos(dataPath) });
        return;
      }

      if (method === 'POST' && pathname === '/todos') {
        const raw = await readBody(req);
        let payload = {};
        if (raw.trim()) payload = JSON.parse(raw);
        const title = typeof payload.title === 'string' ? payload.title.trim() : '';
        if (!title) {
          sendJson(res, 400, { ok: false, error: 'title is required' });
          return;
        }

        const todos = readTodos(dataPath);
        const todo = {
          id: crypto.randomUUID(),
          title,
          done: false,
          createdAt: new Date().toISOString()
        };
        todos.push(todo);
        writeTodos(dataPath, todos);
        sendJson(res, 201, { ok: true, todo });
        return;
      }

      const id = parseId(pathname);
      if (id && method === 'GET') {
        const todos = readTodos(dataPath);
        const todo = todos.find(t => String(t.id) === id);
        if (!todo) {
          sendJson(res, 404, { ok: false, error: 'not found' });
          return;
        }
        sendJson(res, 200, { ok: true, todo });
        return;
      }

      if (id && method === 'PATCH') {
        const raw = await readBody(req);
        let payload = {};
        if (raw.trim()) payload = JSON.parse(raw);
        if (typeof payload.done !== 'boolean') {
          sendJson(res, 400, { ok: false, error: 'done must be boolean' });
          return;
        }

        const todos = readTodos(dataPath);
        const idx = todos.findIndex(t => String(t.id) === id);
        if (idx < 0) {
          sendJson(res, 404, { ok: false, error: 'not found' });
          return;
        }

        const next = { ...todos[idx], done: payload.done };
        if (payload.done) next.doneAt = new Date().toISOString();
        else if (Object.prototype.hasOwnProperty.call(next, 'doneAt')) delete next.doneAt;
        todos[idx] = next;
        writeTodos(dataPath, todos);
        sendJson(res, 200, { ok: true, todo: next });
        return;
      }

      if (id && method === 'DELETE') {
        const todos = readTodos(dataPath);
        const idx = todos.findIndex(t => String(t.id) === id);
        if (idx < 0) {
          sendJson(res, 404, { ok: false, error: 'not found' });
          return;
        }
        todos.splice(idx, 1);
        writeTodos(dataPath, todos);
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: 'internal error' });
    }
  });
}

module.exports = { createServer };
