const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
          res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
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
        if (!todo.title) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Title is required' }));
          return;
        }
        let data = {};
        if (fs.existsSync(dataPath)) {
          data = JSON.parse(fs.readFileSync(dataPath, 'utf8')) || { todos: [] };
        }
        const newTodo = {
          id: crypto.randomUUID(),
          title: todo.title,
          done: false,
          createdAt: new Date().toISOString()
        };
        data.todos.push(newTodo);
        fs.writeFileSync(dataPath, JSON.stringify(data));
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todo: newTodo }));
      } else if (req.method === 'PATCH' && req.url.startsWith('/todos/')) {
        const id = req.url.split('/')[2];
        let data = {};
        if (fs.existsSync(dataPath)) {
          data = JSON.parse(fs.readFileSync(dataPath, 'utf8')) || { todos: [] };
        }
        const todoIndex = data.todos.findIndex(t => t.id === id);
        if (todoIndex !== -1) {
          const update = JSON.parse(body);
          data.todos[todoIndex] = { ...data.todos[todoIndex], ...update, updatedAt: new Date().toISOString() };
          fs.writeFileSync(dataPath, JSON.stringify(data));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo: data.todos[todoIndex] }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });
  });

  return server;
}

module.exports = createServer;