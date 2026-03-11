// src/server.js
const app = require('./app');
const http = require('http');

// Start server without calling listen()
module.exports.startServer = (port) => {
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    }).on('error', (err) => {
      reject(err);

};
