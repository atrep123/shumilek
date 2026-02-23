const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createServer({ dataPath }) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else if (req.method === 'GET' && req.url === '/openapi.json') {
        fs.readFile(path.join(__dirname, '..', 'openapi.json'), (err, data) => {
          if (err) {
            res.writeHead(500);
            res.end();
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(data);
          }
        });
      } else if (req.method === 'GET' && req.url.startsWith('/todos')) {
        const id = req.url.split('/')[3];
        fs.readFile(dataPath, 'utf8', (err, data) => {
          if (err || !data) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false }));
            return;
          }

          const todos = JSON.parse(data);
          if (!id) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, todos }));
          } else {
            const todo = todos.find(t => t.id === id);
            if (todo) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, todo }));
            } else {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false }));
            }
          }
        });
      } else if (req.method === 'POST' && req.url === '/todos') {
        const todo = JSON.parse(body);
        todo.id = crypto.randomUUID();
        todo.createdAt = new Date().toISOString();
        fs.readFile(dataPath, 'utf8', (err, data) => {
          let todos = [];
          if (!err && data) {
            todos = JSON.parse(data);
          }

          todos.push(todo);
          fs.writeFile(dataPath, JSON.stringify(todos), err => {
            if (err) {
              res.writeHead(500);
              res.end();
            } else {
              res.writeHead(201, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, todo }));
            }
          });
        });
      } else if (req.method === 'PATCH' && req.url.startsWith('/todos')) {
        const id = req.url.split('/')[3];
        const update = JSON.parse(body);

        fs.readFile(dataPath, 'utf8', (err, data) => {
          if (err || !data) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false }));
            return;
          }

          let todos = JSON.parse(data);
          const todoIndex = todos.findIndex(t => t.id === id);
          if (todoIndex !== -1) {
            const todo = { ...todos[todoIndex], ...update };
            if (update.done && !todo.doneAt) {
              todo.doneAt = new Date().toISOString();
            }

            todos[todoIndex] = todo;
            fs.writeFile(dataPath, JSON.stringify(todos), err => {
              if (err) {
                res.writeHead(500);
                res.end();
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, todo }));
              }
            });
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false }));
          }
        });
      } else if (req.method === 'DELETE' && req.url.startsWith('/todos')) {
        const id = req.url.split('/')[3];

        fs.readFile(dataPath, 'utf8', (err, data) => {
          if (err || !data) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false }));
            return;
          }

          let todos = JSON.parse(data);
          const todoIndex = todos.findIndex(t => t.id === id);
          if (todoIndex !== -1) {
            todos.splice(todoIndex, 1);
            fs.writeFile(dataPath, JSON.stringify(todos), err => {
              if (err) {
                res.writeHead(500);
                res.end();
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
              }
            });
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false }));
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });

  return server;
}

module.exports = { createServer };
