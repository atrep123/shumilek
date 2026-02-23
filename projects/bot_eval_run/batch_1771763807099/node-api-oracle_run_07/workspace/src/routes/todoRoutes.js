const fs = require('fs');
const path = require('path');
const uuid = require('uuid').v4;

function todoRoutes(req, res, dataPath) {
  const dbPath = path.join(dataPath, 'db.json');

  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({ todos: [] }));
  }

  let data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

  switch (req.url) {
    case '/health':
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      }
      break;

    case '/todos':
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todos: data.todos }));
      } else if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        req.on('end', () => {
          const newTodo = JSON.parse(body);
          newTodo.id = uuid();
          newTodo.createdAt = new Date().toISOString();
          data.todos.push(newTodo);
          fs.writeFileSync(dbPath, JSON.stringify(data));
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo: newTodo }));
        });
      }
      break;

    default:
      if (req.url.startsWith('/todos/') && req.method === 'GET') {
        const id = req.url.split('/')[2];
        const todo = data.todos.find(t => t.id === id);
        if (todo) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'TODO item not found' }));
        }
      } else if (req.url.startsWith('/todos/') && req.method === 'PATCH') {
        const id = req.url.split('/')[2];
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        req.on('end', () => {
          const update = JSON.parse(body);
          const todoIndex = data.todos.findIndex(t => t.id === id);
          if (todoIndex !== -1) {
            data.todos[todoIndex].done = update.done;
            data.todos[todoIndex].doneAt = new Date().toISOString();
            fs.writeFileSync(dbPath, JSON.stringify(data));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, todo: data.todos[todoIndex] }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'TODO item not found' }));
          }
        });
      } else if (req.url.startsWith('/todos/') && req.method === 'DELETE') {
        const id = req.url.split('/')[2];
        const todoIndex = data.todos.findIndex(t => t.id === id);
        if (todoIndex !== -1) {
          data.todos.splice(todoIndex, 1);
          fs.writeFileSync(dbPath, JSON.stringify(data));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'TODO item not found' }));
        }
      }
  }
}

module.exports = todoRoutes;
