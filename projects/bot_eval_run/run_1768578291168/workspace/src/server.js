"use strict";

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const util = require('util');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

function createServer({ dataPath }) {
  let todos = [];

  async function loadTodos() {
    try {
      const data = await readFile(dataPath, 'utf8');
      const parsedData = JSON.parse(data);
      if (Array.isArray(parsedData.todos)) {
        todos = parsedData.todos;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  async function saveTodos() {
    await writeFile(dataPath, JSON.stringify({ todos }, null, 2), 'utf8');
  }

  // Ensure loadTodos is called when the server starts
  (async () => {
    try {
      await loadTodos();
    } catch (err) {
      console.error('Failed to load todos:', err);
    }
  })();

  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        switch (pathname) {
          case '/health':
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            break;

          case '/openapi.json':
            const openApiPath = path.join(__dirname, '..', 'openapi.json');
            const openApiSpec = await readFile(openApiPath);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(openApiSpec);
            break;

          case '/todos':
            if (req.method === 'GET') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, todos }));
            } else if (req.method === 'POST') {
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
              await saveTodos();

              res.writeHead(201, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, todo: newTodo }));
            }
            break;

          default:
            if (pathname.startsWith('/todos/')) {
              const id = pathname.split('/').pop();
              const todoIndex = todos.findIndex(todo => todo.id === id);

              if (todoIndex === -1) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'TODO not found' }));
                return;
              }

              switch (req.method) {
                case 'GET':
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ ok: true, todo: todos[todoIndex] }));
                  break;

                case 'PATCH':
                  const patchData = JSON.parse(body);
                  if (patchData.done !== undefined) {
                    todos[todoIndex].done = patchData.done;
                    if (todos[todoIndex].done && !todos[todoIndex].doneAt) {
                      todos[todoIndex].doneAt = new Date().toISOString();
                    }

                    await saveTodos();

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, todo: todos[todoIndex] }));
                  }
                  break;

                case 'DELETE':
                  todos.splice(todoIndex, 1);
                  await saveTodos();

                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ ok: true }));
                  break;
              }
            }
        }
      } catch (err) {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Internal server error' }));
      }
    });
  });

  return server;
}

module.exports = { createServer };