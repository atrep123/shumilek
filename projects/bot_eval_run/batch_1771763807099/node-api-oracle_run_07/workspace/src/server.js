// Your server code here
const http = require('http');
const fs = require('fs');
const path = require('path');

const routes = require('./routes/todoRoutes');

function createServer(dataPath) {
  return http.createServer((req, res) => {
    if (req.url === '/openapi.json' && req.method === 'GET') {
      const openApiSpec = fs.readFileSync(path.join(__dirname, '../openapi.json'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(openApiSpec);
    } else {
      routes(req, res, dataPath);
    }
  });
}

module.exports = createServer;
