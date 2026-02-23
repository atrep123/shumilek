const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

function createServer({ dataPath }) {
  let todos = [];
  try {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    if (Array.isArray(data.todos)) {
      todos = data.todos;
    }
  } catch (e) {}

  function saveTodos() {
    fs.writeFileSync(dataPath, JSON.stringify({ todos }, null, 2), 'utf8');
  }

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true }));
        }

        if (req.method === 'GET' && req.url === '/openapi.json') {
          const openApiSpec = JSON.parse(fs.readFileSync(__dirname + '/../openapi.json', 'utf8'));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(openApiSpec));
        }

        if (req.method === 'GET' && req.url.startsWith('/todos/')) {
          const id = decodeURIComponent(req.url.split('/').pop());
          const todo = todos.find(t => t.id === id);
          if (!todo) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, todo }));
        }

        if (req.method === 'GET' && req.url === '/todos') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, todos }));
        }

        if (req.method === 'POST' && req.url === '/todos') {
          const newTodo = JSON.parse(body);
          const todo = {
            id: crypto.randomUUID(),
            title: newTodo.title,
            done: false,
            createdAt: new Date().toISOString()
          };
          todos.push(todo);
          saveTodos();
          res.writeHead(201, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, todo }));
        }

        if (req.method === 'PATCH' && req.url.startsWith('/todos/')) {
          const id = decodeURIComponent(req.url.split('/').pop());
          const todoIndex = todos.findIndex(t => t.id === id);
          if (todoIndex === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
          }
          const updatedTodo = JSON.parse(body);
          todos[todoIndex] = {
            ...todos[todoIndex],
            done: updatedTodo.done
          };
          saveTodos();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, todo: todos[todoIndex] }));
        }
      } catch (err) {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }
  });

  server.listen(3000, () => {
    console.log('Server is running on port 3000');
  });
}
