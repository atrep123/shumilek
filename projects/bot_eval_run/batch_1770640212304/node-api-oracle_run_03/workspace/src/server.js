const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

module.exports.createServer = ({ dataPath }) => {
  const todos = [];

  function saveTodos() {
    fs.writeFileSync(dataPath, JSON.stringify({ todos }));
  }

  http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.method === 'GET' && req.url === '/openapi.json') {
      const spec = {
        openapi: '3.0.1',
        info: { title: 'TODO API', version: '1.0.0' },
        paths: {}
      };
      if (!fs.existsSync(dataPath)) fs.writeFileSync(dataPath, JSON.stringify({ todos: [] }));
      spec.paths['/todos'] = { get: { responses: { '200': { description: 'List all todos', content: { 'application/json': {} } } } } };
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
        if (!data.title) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Title is required' }));
        } else {
          const todo = { id: crypto.randomUUID(), title: data.title, done: false, createdAt: new Date().toISOString() };
          todos.push(todo);
          saveTodos();
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo }));
        }
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
          if (data.done !== undefined) todo.done = data.done;
          if (data.done && !todo.doneAt) todo.doneAt = new Date().toISOString();
          todos[todoIndex] = todo;
          saveTodos();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo }));
        }
      });
    } else if (req.method === 'DELETE' && req.url.startsWith('/todos')) {
      const id = req.url.split('/').pop();
      const todoIndex = todos.findIndex(t => t.id === id);
      if (todoIndex === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
      } else {
        todos.splice(todoIndex, 1);
        saveTodos();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    }
  }).listen(3000);
  console.log('Server running at http://localhost:3000');
}