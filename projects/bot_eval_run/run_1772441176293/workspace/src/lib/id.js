const { randomUUID } = require('node:crypto');

exports.generateId = () => randomUUID();
