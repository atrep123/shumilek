const { randomUUID } = require('node:crypto');
exports.generateId = function() {
  return randomUUID();
};