const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createServer(dataFilePath) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/todos') {
        fs.readFile(dataFilePath, 'utf8', (err, data) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false }));
            return;
          }

          const todos = JSON.parse(data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todos }));
        });
      } else if (req.method === 'POST' && req.url === '/todos') {
        const todo = JSON.parse(body);
        todo.id = crypto.randomUUID();
        todo.completed = false;

        fs.readFile(dataFilePath, 'utf8', (err, data) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false }));
            return;
          }

          const todos = JSON.parse(data);
          todos.push(todo);

          fs.writeFile(dataFilePath, JSON.stringify(todos), err => {
            if (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false }));
              return;
            }

            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, todo }));
          });
        });
      } else if (req.method === 'GET') {
        const id = req.url.split('/')[2];

        fs.readFile(dataFilePath, 'utf8', (err, data) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false }));
            return;
          }

          const todos = JSON.parse(data);
          const todo = todos.find(t => t.id === id);

          if (todo) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, todo }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false }));
          }
        });
      } else if (req.method === 'PATCH') {
        const id = req.url.split('/')[2];
        const update = JSON.parse(body);

        fs.readFile(dataFilePath, 'utf8', (err, data) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false }));
            return;
          }

          const todos = JSON.parse(data);
          const todoIndex = todos.findIndex(t => t.id === id);

          if (todoIndex !== -1) {
            todos[todoIndex] = { ...todos[todoIndex], ...update };

            fs.writeFile(dataFilePath, JSON.stringify(todos), err => {
              if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false }));
                return;
              }

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, todo: todos[todoIndex] }));
            });
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false }));
          }
        });
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });
  });

  return server;
}

module.exports = createServer;
