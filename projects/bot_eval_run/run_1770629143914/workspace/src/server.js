const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

function createServer({ dataPath }) {
  let todos = [];

  function loadData() {
    try {
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      if (Array.isArray(data.todos)) {
        todos = data.todos;
      }
    } catch (e) {}
  }

  function saveData() {
    fs.writeFileSync(dataPath, JSON.stringify({ todos }, null, 2), 'utf8');
  }

  loadData();

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else if (req.method === 'GET' && req.url === '/openapi.json') {
          fs.readFile('openapi.json', 'utf8', (err, data) => {
            if (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Internal Server Error' }));
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(data);
            }
          });
        } else if (req.method === 'GET' && req.url.startsWith('/todos')) {
          const id = req.url.split('/')[2];
          if (id) {
            const todo = todos.find(t => t.id === id);
            if (todo) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, todo }));
            } else {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
            }
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, todos }));
          }
        } else if (req.method === 'POST' && req.url === '/todos') {
          const data = JSON.parse(body);
          if (!data.title) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Title is required' }));
            return;
          }
          const newTodo = {
            id: crypto.randomUUID(),
            title: data.title,
            done: false,
            createdAt: new Date().toISOString()
          };
          todos.push(newTodo);
          saveData();
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo: newTodo }));
        } else if (req.method === 'PATCH' && req.url.startsWith('/todos')) {
          const id = req.url.split('/')[2];
          const data = JSON.parse(body);
          const todoIndex = todos.findIndex(t => t.id === id);
          if (todoIndex !== -1) {
            const todo = todos[todoIndex];
            if (data.done !== undefined) {
              todo.done = Boolean(data.done);
              if (todo.done && !todo.doneAt) {
                todo.doneAt = new Date().toISOString();
              }
            }
            saveData();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, todo }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
          }
        } else if (req.method === 'DELETE' && req.url.startsWith('/todos')) {
          const id = req.url.split('/')[2];
          const todoIndex = todos.findIndex(t => t.id === id);
          if (todoIndex !== -1) {
            todos.splice(todoIndex, 1);
            saveData();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
          }
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Internal Server Error' }));
      }
    });
  });

  return server;
}

module.exports = { createServer };
