const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

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
        const openApiSpec = JSON.parse(fs.readFileSync(path.join(__dirname, '../../openapi.json'), 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(openApiSpec));
      } else if (req.method === 'GET' && req.url.startsWith('/todos')) {
        const todos = JSON.parse(fs.readFileSync(dataPath, 'utf8')) || [];
        const id = req.url.split('/')[2];

        if (!id) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todos }));
        } else {
          const todo = todos.find(t => t.id === id);
          if (todo) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, todo }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'TODO item not found' }));
          }
        }
      } else if (req.method === 'POST' && req.url === '/todos') {
        const todo = JSON.parse(body);
        todo.id = crypto.randomUUID();
        todo.createdAt = new Date().toISOString();
        todo.done = false;

        const todos = JSON.parse(fs.readFileSync(dataPath, 'utf8')) || [];
        todos.push(todo);
        fs.writeFileSync(dataPath, JSON.stringify(todos));

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todo }));
      } else if (req.method === 'PATCH' && req.url.startsWith('/todos')) {
        const todos = JSON.parse(fs.readFileSync(dataPath, 'utf8')) || [];
        const id = req.url.split('/')[2];
        const update = JSON.parse(body);

        const todoIndex = todos.findIndex(t => t.id === id);
        if (todoIndex !== -1) {
          const todo = todos[todoIndex];
          if (update.done !== undefined) {
            todo.done = update.done;
            if (todo.done) {
              todo.doneAt = new Date().toISOString();
            }
          }

          fs.writeFileSync(dataPath, JSON.stringify(todos));

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'TODO item not found' }));
        }
      } else if (req.method === 'DELETE' && req.url.startsWith('/todos')) {
        const todos = JSON.parse(fs.readFileSync(dataPath, 'utf8')) || [];
        const id = req.url.split('/')[2];

        const todoIndex = todos.findIndex(t => t.id === id);
        if (todoIndex !== -1) {
          todos.splice(todoIndex, 1);
          fs.writeFileSync(dataPath, JSON.stringify(todos));

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'TODO item not found' }));
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
