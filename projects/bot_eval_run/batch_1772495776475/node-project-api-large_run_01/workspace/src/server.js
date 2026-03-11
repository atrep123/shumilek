// src/server.js
const http = require('http');
const app = require('./app');

function startServer(port) {
  const server = http.createServer(app);

}

module.exports = { startServer };
