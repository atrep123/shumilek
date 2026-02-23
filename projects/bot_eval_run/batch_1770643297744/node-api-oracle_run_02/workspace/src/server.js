module.exports.createServer = ({ dataPath }) => {
  const http = require('http');
  const url = require('url');
  const fs = require('fs');
  const crypto = require('crypto');

  const todos = [];

  return http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else if (parsedUrl.pathname === '/openapi.json') {
      const openapiSpec = {
        openapi: '3.0.0',
        info: { title: 'Todo API', version: '1.0.0' },
        paths: {}
      };
      if (!fs.existsSync(dataPath)) fs.writeFileSync(dataPath, JSON.stringify({ todos: [] }));
      openapiSpec.paths['/todos'] = {
        get: {
          summary: 'Get all todos',
          responses: {
            200: { description: 'List of todos', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Todo' } } }
        },
        post: {
          summary: 'Create a new todo',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/TodoInput' } } }
        }},
        responses: {
          201: { description: 'Created todo', content: { 'application/json': { schema: { $ref: '#/components/schemas/Todo' } } }
        };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(openapiSpec));
    } else if (parsedUrl.pathname === '/todos') {
      // Existing code...
    } else if (parsedUrl.pathname.match(/^/todos/[a-f0-9]+$/i)) {
      // Existing code...
    }
  }).listen(8080);
};
