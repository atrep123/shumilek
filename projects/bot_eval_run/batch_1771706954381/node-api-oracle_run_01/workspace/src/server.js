// Import necessary modules
const http = require('http');
const fs = require('fs');
const path = require('path');

// Function to read data from a file
function readFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

// Function to write data to a file
function writeFile(filePath, data) {
  return new Promise((resolve, reject) => {
    fs.writeFile(filePath, data, 'utf8', (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// Request handler function
async function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;

  try {
    if (url.pathname === '/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy' }));
    } else if (url.pathname === '/todos' && method === 'GET') {
      const data = await readFile('data/todos.json');
      const todos = JSON.parse(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, todos }));
    } else if (url.pathname === '/todos' && method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', async () => {
        const newTodo = JSON.parse(body);
        newTodo.id = Date.now().toString();
        newTodo.createdAt = new Date().toISOString();
        newTodo.done = false;

        let data = await readFile('data/todos.json');
        let todos = JSON.parse(data);
        todos.push(newTodo);
        await writeFile('data/todos.json', JSON.stringify(todos, null, 2));

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todo: newTodo }));
      });
    } else if (url.pathname.startsWith('/todos/') && method === 'GET') {
      const id = url.pathname.split('/')[2];

      let data = await readFile('data/todos.json');
      let todos = JSON.parse(data);
      const todo = todos.find(t => t.id === id);

      if (todo) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todo }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'TODO item not found' }));
      }
    } else if (url.pathname.startsWith('/todos/') && method === 'PATCH') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', async () => {
        const update = JSON.parse(body);
        const id = url.pathname.split('/')[2];

        let data = await readFile('data/todos.json');
        let todos = JSON.parse(data);
        const todoIndex = todos.findIndex(t => t.id === id);

        if (todoIndex !== -1) {
          todos[todoIndex].done = update.done;
          if (update.done) {
            todos[todoIndex].doneAt = new Date().toISOString();
          }
          await writeFile('data/todos.json', JSON.stringify(todos, null, 2));

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo: todos[todoIndex] }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'TODO item not found' }));
        }
      });
    } else if (url.pathname.startsWith('/todos/') && method === 'DELETE') {
      const id = url.pathname.split('/')[2];

      let data = await readFile('data/todos.json');
      let todos = JSON.parse(data);
      todos = todos.filter(t => t.id !== id);
      await writeFile('data/todos.json', JSON.stringify(todos, null, 2));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Internal Server Error' }));
  }
}

// Create server and listen on port 3000
const server = http.createServer(requestHandler);
server.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
});