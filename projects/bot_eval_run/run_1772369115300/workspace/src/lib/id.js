const { randomUUID } = require("node:crypto");

module.exports = {
  generateId: () => randomUUID()
};
