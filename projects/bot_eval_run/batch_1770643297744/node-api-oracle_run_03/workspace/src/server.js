const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

module.exports.createServer = ({ dataPath }) => {
  const todos = [];

  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.method === 'GET' && req.url === '/openapi.json') {
      const spec = {
        openapi: '3.0.0',
        paths: { '/todos': {} }
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(spec));
    } else if (req.method === 'GET' && req.url.startsWith('/todos')) {
      const id = req.url.split('/').pop();
      const todo = todos.find(t => t.id === id);
      if (!todo) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todo }));
      }
    } else if (req.method === 'POST' && req.url === '/todos') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        const data = JSON.parse(body);
        const todo = { id: crypto.randomUUID(), title: data.title, done: false, createdAt: new Date().toISOString() };
        todos.push(todo);
        fs.writeFileSync(dataPath, JSON.stringify({ todos }));
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todo }));
      });
    } else if (req.method === 'PATCH' && req.url.startsWith('/todos')) {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        const data = JSON.parse(body);
        const id = req.url.split('/').pop();
        const todoIndex = todos.findIndex(t => t.id === id);
        if (todoIndex === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
        } else {
          const todo = todos[todoIndex];
          if (data.done !== undefined) {
            todo.done = data.done;
            if (todo.done) {
              todo.doneAt = new Date().toISOString();
            }
          }
          fs.writeFileSync(dataPath, JSON.stringify({ todos }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo }));
        }
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    }
  }).listen(8080);
};
