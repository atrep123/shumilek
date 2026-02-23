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
    req.on('data', chunk => { body += String(chunk); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function createServer({ dataPath }) {
  return http.createServer(async (req, res) => {
    try {
      const method = String(req.method || 'GET').toUpperCase();
      const url = new URL(String(req.url || '/'), 'http://127.0.0.1');
      const pathname = url.pathname;
      const idMatch = pathname.match(/^\/todos\/([^/]+)$/);
      const id = idMatch ? decodeURIComponent(idMatch[1]) : null;

      if (method === 'GET' && pathname === '/health') return sendJson(res, 200, { ok: true });
      if (method === 'GET' && pathname === '/openapi.json') {
        const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi.json'), 'utf8'));
        return sendJson(res, 200, spec);
      }
      if (method === 'GET' && pathname === '/todos') return sendJson(res, 200, { ok: true, todos: readTodos(dataPath) });
      if (method === 'POST' && pathname === '/todos') {
        const body = await readBody(req);
        const payload = body.trim() ? JSON.parse(body) : {};
        const title = typeof payload.title === 'string' ? payload.title.trim() : '';
        if (!title) return sendJson(res, 400, { ok: false, error: 'title is required' });
        const todos = readTodos(dataPath);
        const todo = { id: crypto.randomUUID(), title, done: false, createdAt: new Date().toISOString() };
        todos.push(todo);
        writeTodos(dataPath, todos);
        return sendJson(res, 201, { ok: true, todo });
      }
      if (method === 'GET' && id) {
        const todo = readTodos(dataPath).find(t => String(t.id) === id);
        if (!todo) return sendJson(res, 404, { ok: false, error: 'not found' });
        return sendJson(res, 200, { ok: true, todo });
      }
      if (method === 'PATCH' && id) {
        const body = await readBody(req);
        const payload = body.trim() ? JSON.parse(body) : {};
        if (typeof payload.done !== 'boolean') return sendJson(res, 400, { ok: false, error: 'done must be boolean' });
        const todos = readTodos(dataPath);
        const idx = todos.findIndex(t => String(t.id) === id);
        if (idx < 0) return sendJson(res, 404, { ok: false, error: 'not found' });
        const next = { ...todos[idx], done: payload.done };
        if (payload.done) next.doneAt = new Date().toISOString();
        else if (Object.prototype.hasOwnProperty.call(next, 'doneAt')) delete next.doneAt;
        todos[idx] = next;
        writeTodos(dataPath, todos);
        return sendJson(res, 200, { ok: true, todo: next });
      }
      if (method === 'DELETE' && id) {
        const todos = readTodos(dataPath);
        const idx = todos.findIndex(t => String(t.id) === id);
        if (idx < 0) return sendJson(res, 404, { ok: false, error: 'not found' });
        todos.splice(idx, 1);
        writeTodos(dataPath, todos);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 404, { ok: false, error: 'not found' });
    } catch {
      return sendJson(res, 500, { ok: false, error: 'internal error' });
    }
  });
}

module.exports = { createServer };
