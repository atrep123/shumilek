const { randomUUID } = require('node:crypto');

function generateId() {
  return randomUUID();
}

module.exports = { generateId };