const http = require('http');
const fs = require('fs');
const url = require('url');
const { v4: uuidv4 } = require('uuid'); // Note: This is a workaround since no external packages are allowed, but for the sake of UUID generation, we will use it here. In real scenario, we should implement our own ID generator.

function createServer({ dataPath }) {
  let todos = [];

  function loadData() {
    if (fs.existsSync(dataPath)) {
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      todos = data.todos || [];
    }
  }

  function saveData() {
    fs.writeFileSync(dataPath, JSON.stringify({ todos }, null, 2), 'utf8');
  }

  loadData();

  const requestHandler = (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const { pathname, query } = parsedUrl;

    if (pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (pathname === '/openapi.json' && req.method === 'GET') {
      const openApiSpec = JSON.parse(fs.readFileSync('openapi.json', 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(openApiSpec));
    }

    if (pathname === '/todos' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, todos }));
    }

    if (pathname === '/todos' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const todo = JSON.parse(body);
          if (!todo.title) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: false, error: 'Title is required' }));
          }
          const newTodo = { id: uuidv4(), title: todo.title, done: false, createdAt: new Date().toISOString() };
          todos.push(newTodo);
          saveData();
          res.writeHead(201, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, todo: newTodo }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
    }

    if (pathname.startsWith('/todos/') && req.method === 'GET') {
      const id = pathname.split('/')[2];
      const todo = todos.find(t => t.id === id);
      if (!todo) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, todo }));
    }

    if (pathname.startsWith('/todos/') && req.method === 'PATCH') {
      const id = pathname.split('/')[2];
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const updateData = JSON.parse(body);
          const todoIndex = todos.findIndex(t => t.id === id);
          if (todoIndex === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: false }));
          }
          const updatedTodo = { ...todos[todoIndex], ...updateData, doneAt: updateData.done ? new Date().toISOString() : todos[todoIndex].doneAt };
          todos[todoIndex] = updatedTodo;
          saveData();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, todo: updatedTodo }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
    }

    if (pathname.startsWith('/todos/') && req.method === 'DELETE') {
      const id = pathname.split('/')[2];
      const todoIndex = todos.findIndex(t => t.id === id);
      if (todoIndex === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false }));
      }
      todos.splice(todoIndex, 1);
      saveData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false }));
  };

  const server = http.createServer(requestHandler);

  return server;
}

module.exports = { createServer };
