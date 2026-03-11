const { randomUUID } = require('node:crypto');

const generateId = () => {
  return randomUUID();
};

module.exports = { generateId };
