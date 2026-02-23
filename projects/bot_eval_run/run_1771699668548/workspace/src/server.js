const http = require('http');
const fs = require('fs');
const path = require('path');

function createServer(dataFilePath) {
  let todos = [];

  try {
    const data = fs.readFileSync(dataFilePath, 'utf8');
    todos = JSON.parse(data);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  const server = http.createServer((req, res) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/todos') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todos }));
      } else if (req.method === 'POST' && req.url === '/todos') {
        const todo = JSON.parse(body);
        todo.id = crypto.randomUUID();
        todo.completed = false;
        todos.push(todo);

        fs.writeFileSync(dataFilePath, JSON.stringify(todos, null, 2));

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todo }));
      } else if (req.method === 'GET') {
        const id = req.url.split('/')[2];
        const todo = todos.find(t => t.id === id);

        if (todo) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
        }
      } else if (req.method === 'PATCH') {
        const id = req.url.split('/')[2];
        let todo = todos.find(t => t.id === id);

        if (todo) {
          const update = JSON.parse(body);
          todo = { ...todo, ...update };

          fs.writeFileSync(dataFilePath, JSON.stringify(todos, null, 2));

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
        }
      } else if (req.method === 'DELETE') {
        const id = req.url.split('/')[2];
        const index = todos.findIndex(t => t.id === id);

        if (index !== -1) {
          todos.splice(index, 1);

          fs.writeFileSync(dataFilePath, JSON.stringify(todos, null, 2));

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo: {} }));
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

module.exports = createServer;
