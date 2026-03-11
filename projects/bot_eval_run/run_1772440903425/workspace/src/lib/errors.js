class CustomError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const sendError = (res, status, code, message) => res.status(status).json({ error: { code, message } });
module.exports = { CustomError, sendError };