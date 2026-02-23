// src/server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse } = require('node:url');

function createServer({ dataPath }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;

    if (url.pathname === '/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === '/openapi.json' && method === 'GET') {
      const openApiSpec = JSON.parse(fs.readFileSync(path.join(__dirname, '../openapi.json'), 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(openApiSpec));
      return;
    }

    if (url.pathname === '/todos' && method === 'GET') {
      let todos = [];
      if (fs.existsSync(dataPath)) {
        todos = JSON.parse(fs.readFileSync(dataPath, 'utf8')).todos || [];
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, todos }));
      return;
    }

    if (url.pathname === '/todos' && method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        const { title } = JSON.parse(body);
        if (!title) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Title is required' }));
          return;
        }

        const todo = {
          id: crypto.randomUUID(),
          title,
          done: false,
          createdAt: new Date().toISOString()
        };

        let todos = [];
        if (fs.existsSync(dataPath)) {
          todos = JSON.parse(fs.readFileSync(dataPath, 'utf8')).todos || [];
        }
        todos.push(todo);
        fs.writeFileSync(dataPath, JSON.stringify({ todos }, null, 2));

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todo }));
      });
      return;
    }

    if (url.pathname.startsWith('/todos/') && method === 'GET') {
      const id = url.pathname.split('/')[2];
      let todos = [];
      if (fs.existsSync(dataPath)) {
        todos = JSON.parse(fs.readFileSync(dataPath, 'utf8')).todos || [];
      }
      const todo = todos.find(t => t.id === id);
      if (!todo) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, todo }));
      return;
    }

    if (url.pathname.startsWith('/todos/') && method === 'PATCH') {
      const id = url.pathname.split('/')[2];
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        const { done } = JSON.parse(body);
        if (done === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Done status is required' }));
          return;
        }

        let todos = [];
        if (fs.existsSync(dataPath)) {
          todos = JSON.parse(fs.readFileSync(dataPath, 'utf8')).todos || [];
        }
        const todoIndex = todos.findIndex(t => t.id === id);
        if (todoIndex === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
          return;
        }

        const todo = todos[todoIndex];
        todo.done = done;
        if (done) {
          todo.doneAt = new Date().toISOString();
        }
        todos[todoIndex] = todo;
        fs.writeFileSync(dataPath, JSON.stringify({ todos }, null, 2));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todo }));
      });
      return;
    }

    if (url.pathname.startsWith('/todos/') && method === 'DELETE') {
      const id = url.pathname.split('/')[2];
      let todos = [];
      if (fs.existsSync(dataPath)) {
        todos = JSON.parse(fs.readFileSync(dataPath, 'utf8')).todos || [];
      }
      const todoIndex = todos.findIndex(t => t.id === id);
      if (todoIndex === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
        return;
      }

      todos.splice(todoIndex, 1);
      fs.writeFileSync(dataPath, JSON.stringify({ todos }, null, 2));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  return server;
}

module.exports = { createServer };