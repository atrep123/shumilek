const http = require('http');
const fs = require('fs');
const url = require('url');
const { v4: uuidv4 } = (() => {
  // Simple UUID generator since no external libraries are allowed
  return () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };
})();

function loadData(dataPath) {
  try {
    if (fs.existsSync(dataPath)) {
      const data = fs.readFileSync(dataPath, 'utf8');
      return JSON.parse(data).todos || [];
    }
  } catch (e) {}
  return [];
}

function saveData(dataPath, todos) {
  const data = { todos: todos };
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

function createServer({ dataPath }) {
  let todos = loadData(dataPath);

  function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathName = parsedUrl.pathname;

    if (pathName === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else if (pathName === '/openapi.json' && req.method === 'GET') {
      const openApiSpec = require('../openapi.json');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(openApiSpec));
    } else if (pathName.startsWith('/todos/') && req.method === 'GET') {
      const id = pathName.split('/').pop();
      const todo = todos.find(t => t.id === id);
      if (todo) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todo }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'TODO not found' }));
      }
    } else if (pathName === '/todos' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, todos }));
    } else if (pathName === '/todos' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const todoData = JSON.parse(body);
          if (!todoData.title) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Title is required' }));
            return;
          }
          const todo = {
            id: uuidv4(),
            title: todoData.title,
            done: false,
            createdAt: new Date().toISOString()
          };
          todos.push(todo);
          saveData(dataPath, todos);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
    } else if (pathName.startsWith('/todos/') && req.method === 'PATCH') {
      const id = pathName.split('/').pop();
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const updateData = JSON.parse(body);
          if (typeof updateData.done !== 'boolean') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Done must be a boolean' }));
            return;
          }
          const todo = todos.find(t => t.id === id);
          if (todo) {
            todo.done = updateData.done;
            if (updateData.done && !todo.doneAt) {
              todo.doneAt = new Date().toISOString();
            } else if (!updateData.done) {
              delete todo.doneAt;
            }
            saveData(dataPath, todos);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, todo }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'TODO not found' }));
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
    } else if (pathName.startsWith('/todos/') && req.method === 'DELETE') {
      const id = pathName.split('/').pop();
      const index = todos.findIndex(t => t.id === id);
      if (index !== -1) {
        todos.splice(index, 1);
        saveData(dataPath, todos);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'TODO not found' }));
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
    }
  }

  const server = http.createServer(handleRequest);

  return server;
}

module.exports = createServer;
