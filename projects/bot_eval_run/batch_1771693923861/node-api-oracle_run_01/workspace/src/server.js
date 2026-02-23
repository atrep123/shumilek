const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createServer({ dataPath }) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else if (req.method === 'GET' && req.url === '/openapi.json') {
        const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '../openapi.json'), 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(spec));
      } else if (req.method === 'GET' && req.url.startsWith('/todos/')) {
        const id = req.url.split('/')[2];
        let data = {};
        if (fs.existsSync(dataPath)) {
          data = JSON.parse(fs.readFileSync(dataPath, 'utf8')) || { todos: [] };
        }
        const todo = data.todos.find(t => t.id === id);
        if (todo) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'TODO not found' }));
        }
      } else if (req.method === 'GET' && req.url === '/todos') {
        let data = {};
        if (fs.existsSync(dataPath)) {
          data = JSON.parse(fs.readFileSync(dataPath, 'utf8')) || { todos: [] };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todos: data.todos }));
      } else if (req.method === 'POST' && req.url === '/todos') {
        const todo = JSON.parse(body);
        todo.id = crypto.randomUUID();
        todo.createdAt = new Date().toISOString();
        let data = {};
        if (fs.existsSync(dataPath)) {
          data = JSON.parse(fs.readFileSync(dataPath, 'utf8')) || { todos: [] };
        }
        data.todos.push(todo);
        fs.writeFileSync(dataPath, JSON.stringify(data));
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(todo));
      } else if (req.method === 'PATCH' && req.url.startsWith('/todos/')) {
        const id = req.url.split('/')[2];
        const update = JSON.parse(body);
        let data = {};
        if (fs.existsSync(dataPath)) {
          data = JSON.parse(fs.readFileSync(dataPath, 'utf8')) || { todos: [] };
        }
        const todoIndex = data.todos.findIndex(t => t.id === id);
        if (todoIndex !== -1) {
          const todo = data.todos[todoIndex];
          if (update.done !== undefined) {
            todo.done = update.done;
            if (todo.done) {
              todo.doneAt = new Date().toISOString();
            }
          }
          fs.writeFileSync(dataPath, JSON.stringify(data));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(todo));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'TODO not found' }));
        }
      } else if (req.method === 'DELETE' && req.url.startsWith('/todos/')) {
        const id = req.url.split('/')[2];
        let data = {};
        if (fs.existsSync(dataPath)) {
          data = JSON.parse(fs.readFileSync(dataPath, 'utf8')) || { todos: [] };
        }
        const todoIndex = data.todos.findIndex(t => t.id === id);
        if (todoIndex !== -1) {
          data.todos.splice(todoIndex, 1);
          fs.writeFileSync(dataPath, JSON.stringify(data));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'TODO not found' }));
        }
      }
    });
  });
}
module.exports.createServer = createServer;