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

    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else if (req.method === 'GET' && req.url === '/openapi.json') {
        const openApiSpec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi.json'), 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(openApiSpec));
      } else if (req.method === 'GET' && req.url.startsWith('/todos')) {
        const todos = JSON.parse(fs.readFileSync(dataPath, 'utf8')).todos || [];
        if (req.url === '/todos') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todos }));
        } else {
          const id = req.url.split('/')[2];
          const todo = todos.find(t => t.id === id);
          if (todo) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, todo }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
          }
        }
      } else if (req.method === 'POST' && req.url === '/todos') {
        const todo = JSON.parse(body);
        if (!todo.title) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Title is required' }));
          return;
        }
        const newTodo = {
          id: crypto.randomUUID(),
          title: todo.title,
          done: false,
          createdAt: new Date().toISOString()
        };
        const todos = JSON.parse(fs.readFileSync(dataPath, 'utf8')).todos || [];
        todos.push(newTodo);
        fs.writeFileSync(dataPath, JSON.stringify({ todos }, null, 2));
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todo: newTodo }));
      } else if (req.method === 'PATCH' && req.url.startsWith('/todos')) {
        const id = req.url.split('/')[2];
        const update = JSON.parse(body);
        let todos = JSON.parse(fs.readFileSync(dataPath, 'utf8')).todos || [];
        const todoIndex = todos.findIndex(t => t.id === id);
        if (todoIndex !== -1) {
          todos[todoIndex] = { ...todos[todoIndex], ...update };
          if (update.done && !todos[todoIndex].doneAt) {
            todos[todoIndex].doneAt = new Date().toISOString();
          }
          fs.writeFileSync(dataPath, JSON.stringify({ todos }, null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo: todos[todoIndex] }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
        }
      } else if (req.method === 'DELETE' && req.url.startsWith('/todos')) {
        const id = req.url.split('/')[2];
        let todos = JSON.parse(fs.readFileSync(dataPath, 'utf8')).todos || [];
        const todoIndex = todos.findIndex(t => t.id === id);
        if (todoIndex !== -1) {
          todos.splice(todoIndex, 1);
          fs.writeFileSync(dataPath, JSON.stringify({ todos }, null, 2));
          res.writeHead(204);
          res.end();
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

module.exports = { createServer };