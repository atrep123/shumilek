// src/server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse } = require('node:url');

function createServer({ dataPath }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost/');
    const method = req.method;
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        if (url.pathname === '/health' && method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (url.pathname === '/openapi.json' && method === 'GET') {
          const openapi = JSON.parse(fs.readFileSync(path.join(__dirname, '../openapi.json'), 'utf8'));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(openapi));
          return;
        }

        let todosData = fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, 'utf8')) : { todos: [] };

        if (url.pathname === '/todos' && method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todos: todosData.todos }));
          return;
        }

        if (url.pathname === '/todos' && method === 'POST') {
          const todo = JSON.parse(body);
          if (!todo.title) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Title is required' }));
            return;
          }

          const newTodo = {
            id: crypto.randomUUID(),
            title: todo.title,
            done: false,
            createdAt: new Date().toISOString()
          };

          todosData.todos.push(newTodo);
          fs.writeFileSync(dataPath, JSON.stringify(todosData));

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo: newTodo }));
          return;
        }

        const id = url.pathname.split('/').pop();
        if (id) {
          const todoIndex = todosData.todos.findIndex(t => t.id === id);

          if (url.pathname.startsWith('/todos/') && method === 'GET') {
            if (todoIndex !== -1) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, todo: todosData.todos[todoIndex] }));
            } else {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
            }
            return;
          }

          if (url.pathname.startsWith('/todos/') && method === 'PATCH') {
            const update = JSON.parse(body);
            if (todoIndex !== -1) {
              todosData.todos[todoIndex] = {
                ...todosData.todos[todoIndex],
                done: update.done,
                ...(update.done ? { doneAt: new Date().toISOString() } : {})
              };

              fs.writeFileSync(dataPath, JSON.stringify(todosData));

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, todo: todosData.todos[todoIndex] }));
            } else {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
            }
            return;
          }

          if (url.pathname.startsWith('/todos/') && method === 'DELETE') {
            if (todoIndex !== -1) {
              todosData.todos.splice(todoIndex, 1);
              fs.writeFileSync(dataPath, JSON.stringify(todosData));

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true }));
            } else {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
            }
            return;
          }
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
      } catch (err) {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Internal Server Error' }));
      }
    });
  });

  return server;
}

module.exports = {
  createServer
};
