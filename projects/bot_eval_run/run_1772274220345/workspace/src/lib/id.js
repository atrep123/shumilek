const crypto = require('node:crypto');

function generateId() {
  return crypto.randomUUID();
}

module.exports = { generateId };
