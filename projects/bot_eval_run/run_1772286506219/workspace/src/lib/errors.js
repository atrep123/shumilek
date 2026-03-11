function createError(status, code, message) {
  return { error: { code, message } };
}

module.exports = { createError };
