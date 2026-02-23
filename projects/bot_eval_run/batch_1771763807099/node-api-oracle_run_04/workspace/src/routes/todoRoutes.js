const fs = require('fs');
const path = require('path');
const uuid = require('uuid').v4;

function todoRoutes(req, res, dataPath) {
  const dbPath = path.join(dataPath, 'todos.json');

  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify([]));
  }

  let todos = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy' }));
  } else if (req.url === '/todos' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, todos }));
  } else if (req.url === '/todos' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const newTodo = JSON.parse(body);
      newTodo.id = uuid();
      newTodo.createdAt = new Date().toISOString();
      todos.push(newTodo);
      fs.writeFileSync(dbPath, JSON.stringify(todos));
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, todo: newTodo }));
    });
  } else if (req.url.startsWith('/todos/') && req.method === 'GET') {
    const id = req.url.split('/')[2];
    const todo = todos.find(t => t.id === id);
    if (todo) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, todo }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'TODO item not found' }));
    }
  } else if (req.url.startsWith('/todos/') && req.method === 'PATCH') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const id = req.url.split('/')[2];
      const update = JSON.parse(body);
      const todoIndex = todos.findIndex(t => t.id === id);
      if (todoIndex !== -1) {
        todos[todoIndex] = { ...todos[todoIndex], ...update, doneAt: update.done ? new Date().toISOString() : null };
        fs.writeFileSync(dbPath, JSON.stringify(todos));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todo: todos[todoIndex] }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'TODO item not found' }));
      }
    });
  } else if (req.url.startsWith('/todos/') && req.method === 'DELETE') {
    const id = req.url.split('/')[2];
    const todoIndex = todos.findIndex(t => t.id === id);
    if (todoIndex !== -1) {
      todos.splice(todoIndex, 1);
      fs.writeFileSync(dbPath, JSON.stringify(todos));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'TODO item not found' }));
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

module.exports = todoRoutes;
