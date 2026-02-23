// Your server code here
const http = require('http');
const fs = require('fs');
const path = require('path');

function createServer(dataPath) {
  const server = http.createServer((req, res) => {
    let url = req.url;
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy' }));
    } else if (url === '/openapi.json') {
      fs.readFile(path.join(__dirname, '../openapi.json'), (err, data) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Internal Server Error' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(data);
        }
      });
    } else if (url === '/todos') {
      if (req.method === 'GET') {
        fs.readFile(dataPath, (err, data) => {
          let todos = [];
          if (!err && data.length > 0) {
            try {
              todos = JSON.parse(data);
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Internal Server Error' }));
              return;
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todos }));
        });
      } else if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const todo = JSON.parse(body);
            if (!todo.title) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Title is required' }));
              return;
            }
            const newTodo = {
              id: Date.now().toString(),
              title: todo.title,
              done: false,
              createdAt: new Date().toISOString()
            };
            fs.readFile(dataPath, (err, data) => {
              let todos = [];
              if (!err && data.length > 0) {
                try {
                  todos = JSON.parse(data);
                } catch (e) {
                  res.writeHead(500, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ ok: false, error: 'Internal Server Error' }));
                  return;
                }
              }
              todos.push(newTodo);
              fs.writeFile(dataPath, JSON.stringify(todos), err => {
                if (err) {
                  res.writeHead(500, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ ok: false, error: 'Internal Server Error' }));
                } else {
                  res.writeHead(201, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ ok: true, todo: newTodo }));
                }
              });
            });
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
          }
        });
      }
    } else if (url.startsWith('/todos/')) {
      const id = url.split('/')[2];
      fs.readFile(dataPath, (err, data) => {
        let todos = [];
        if (!err && data.length > 0) {
          try {
            todos = JSON.parse(data);
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Internal Server Error' }));
            return;
          }
        }
        const todoIndex = todos.findIndex(t => t.id === id);
        if (todoIndex === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'TODO item not found' }));
          return;
        }
        if (req.method === 'GET') {
          const todo = todos[todoIndex];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo }));
        } else if (req.method === 'PATCH') {
          let body = '';
          req.on('data', chunk => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              const update = JSON.parse(body);
              if (!update.done) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Done status is required' }));
                return;
              }
              const updatedTodo = {
                ...todos[todoIndex],
                done: update.done,
                doneAt: new Date().toISOString()
              };
              todos[todoIndex] = updatedTodo;
              fs.writeFile(dataPath, JSON.stringify(todos), err => {
                if (err) {
                  res.writeHead(500, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ ok: false, error: 'Internal Server Error' }));
                } else {
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ ok: true, todo: updatedTodo }));
                }
              });
            } catch (e) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
            }
          });
        } else if (req.method === 'DELETE') {
          todos.splice(todoIndex, 1);
          fs.writeFile(dataPath, JSON.stringify(todos), err => {
            if (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Internal Server Error' }));
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true }));
            }
          });
        }
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  return server;
}

module.exports = createServer;