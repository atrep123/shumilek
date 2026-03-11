// src/lib/errors.js
function sendError(res, statusCode, code, message) {
  res.status(statusCode).json({ error: { code, message } });
}

module.exports = { sendError };
