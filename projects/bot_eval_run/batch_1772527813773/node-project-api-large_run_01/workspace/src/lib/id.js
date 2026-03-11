const crypto = require('crypto');

const randomUUID = () => {
  return crypto.randomUUID();
};

module.exports = { randomUUID };
