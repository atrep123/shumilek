module.exports.createServer = ({ dataPath }) => {
  const todos = [];

  if (fs.existsSync(dataPath)) {
    const fileData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    todos.push(...fileData.todos);
  }

  return http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else if (parsedUrl.pathname === '/openapi.json') {
      const openApiSpec = {
        openapi: '3.0.0',
        paths: { '/todos': {} }
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(openApiSpec));
    } else if (parsedUrl.pathname === '/todos') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, todos }));
      } else if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          const todoData = JSON.parse(body);
          const newTodo = {
            id: crypto.randomUUID(),
            title: todoData.title,
            done: false,
            createdAt: new Date().toISOString()
          };
          todos.push(newTodo);
          fs.writeFileSync(dataPath, JSON.stringify({ todos }));
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo: newTodo }));
        });
      }
    } else if (parsedUrl.pathname.match(/^/todos/[a-f0-9]+$/)) {
      const id = parsedUrl.pathname.split('/').pop();
      if (req.method === 'GET') {
        const todo = todos.find(t => t.id === id);
        if (todo) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, todo }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
        }
      } else if (req.method === 'PATCH') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          const updates = JSON.parse(body);
          const todoIndex = todos.findIndex(t => t.id === id);
          if (todoIndex !== -1) {
            todos[todoIndex].done = updates.done;
            fs.writeFileSync(dataPath, JSON.stringify({ todos }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, todo: todos[todoIndex] }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
          }
        });
      } else if (req.method === 'DELETE') {
        const todoIndex = todos.findIndex(t => t.id === id);
        if (todoIndex !== -1) {
          todos.splice(todoIndex, 1);
          fs.writeFileSync(dataPath, JSON.stringify({ todos }));
          res.writeHead(204, { 'Content-Type': 'application/json' });
          res.end();
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Todo not found' }));
        }
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
    }
  }).listen(8080);
};