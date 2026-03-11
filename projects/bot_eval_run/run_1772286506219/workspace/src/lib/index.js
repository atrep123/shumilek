function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

function createError(statusCode, code, message) {
  return { statusCode, error: { code, message } };
}

module.exports = { generateId, createError };
