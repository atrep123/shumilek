const http = require('node:http');
const url = require('node:url');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function createServer({ dataPath }) {
  const todos = [];

  function readTodos() {
    if (fs.existsSync(dataPath)) {
      return JSON.parse(fs.readFileSync(dataPath, 'utf8')).todos;
    } else {
      return [];
    }
  }

  function writeTodos(newTodos) {
    fs.writeFileSync(dataPath, JSON.stringify({ todos: newTodos }));
  }

  const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else if (parsedUrl.pathname === '/openapi.json') {
      const openApiSpec = {
        openapi: '3.0.0',
        paths: { '/todos': {} }
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(openApiSpec));
    } else if (parsedUrl.pathname === '/todos') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todos: readTodos() }));
      } else if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          const newTodo = JSON.parse(body);
          newTodo.id = crypto.randomUUID();
          newTodo.createdAt = new Date().toISOString();
          todos.push(newTodo);
          writeTodos(todos);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo: newTodo }));
        });
      } else {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
      }
    } else if (parsedUrl.pathname.startsWith('/todos/')) {
      const todoId = parsedUrl.pathname.split('/')[2];
      if (req.method === 'GET') {
        const todo = todos.find(t => t.id === todoId);
        if (todo) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Todo Not Found' }));
        }
      } else if (req.method === 'PATCH') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          const updatedFields = JSON.parse(body);
          const index = todos.findIndex(t => t.id === todoId);
          if (index !== -1) {
            Object.assign(todos[index], updatedFields);
            writeTodos(todos);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, todo: todos[index] }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Todo Not Found' }));
          }
        });
      } else if (req.method === 'DELETE') {
        const index = todos.findIndex(t => t.id === todoId);
        if (index !== -1) {
          todos.splice(index, 1);
          writeTodos(todos);
          res.writeHead(204, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Todo Not Found' }));
        }
      } else {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
    }
  });

  return server;
}

module.exports = createServer;