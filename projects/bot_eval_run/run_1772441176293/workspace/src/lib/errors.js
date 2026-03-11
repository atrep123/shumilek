class BadRequestError extends Error {
  constructor(message) { super(message); this.name = 'BadRequestError'; }
}

class NotFoundError extends Error {
  constructor(message) { super(message); this.name = 'NotFoundError'; }
}

function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}
