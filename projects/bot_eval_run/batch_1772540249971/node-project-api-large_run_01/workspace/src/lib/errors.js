const sendError = (res, status, code, message) => {
  res.status(status).json({ error: { code, message } });
};

module.exports = {
  sendError,
  BadRequestError: class BadRequestError extends Error {
    constructor(message) {
      super(message);
      this.code = 'BAD_REQUEST';
    }
  },
  NotFoundError: class NotFoundError extends Error {
    constructor(message) {
      super(message);
      this.code = 'NOT_FOUND';
    }
  },
  ConflictError: class ConflictError extends Error {
    constructor(message) {
      super(message);
      this.code = 'CONFLICT';
    }
  }
};
