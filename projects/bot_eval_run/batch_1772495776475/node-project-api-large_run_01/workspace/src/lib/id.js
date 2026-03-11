// src/lib/id.js
const { randomUUID } = require('node:crypto');

function generateId() {
  return randomUUID();
}

module.exports = { generateId };
