function createServer({ dataPath }) {
  const todos = [];

  function readTodos() {
    if (fs.existsSync(dataPath)) {
      const fileContent = fs.readFileSync(dataPath, 'utf8');
      return JSON.parse(fileContent).todos || [];
    } else {
      return [];
    }
  }

  function writeTodos() {
    fs.writeFileSync(dataPath, JSON.stringify({ todos }, null, 2));
  }

  const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else if (parsedUrl.pathname === '/openapi.json') {
      const openApiSpec = {
        openapi: '3.0.0',
        info: { title: 'TODO API', version: '1.0.0' },
        paths: {
          '/todos': { get: { summary: 'Seznam všech TODO položek' } }
        }
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(openApiSpec));
    } else if (parsedUrl.pathname === '/todos') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todos: readTodos() }));
      } else if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          const newTodo = JSON.parse(body);
          if (!newTodo.title) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, message: 'Title is required' }));
          } else {
            const todo = { id: crypto.randomUUID(), ...newTodo };
            todos.push(todo);
            writeTodos();
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, todo }));
          }
        });
      } else if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
      }
    } else if (parsedUrl.pathname.startsWith('/todos/')) {
      const id = parsedUrl.pathname.split('/')[2];
      if (req.method === 'GET') {
        const todo = todos.find(t => t.id === id);
        if (todo) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Todo not found' }));
        }
      } else if (req.method === 'PATCH') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          const updatedFields = JSON.parse(body);
          const index = todos.findIndex(t => t.id === id);
          if (index !== -1) {
            todos[index] = { ...todos[index], ...updatedFields };
            writeTodos();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, todo: todos[index] }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, message: 'Todo not found' }));
          }
        });
      } else if (req.method === 'DELETE') {
        const index = todos.findIndex(t => t.id === id);
        if (index !== -1) {
          todos.splice(index, 1);
          writeTodos();
          res.writeHead(204, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Todo not found' }));
        }
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: 'Not Found' }));
    }
  });

  return server;
}

module.exports = createServer; 
