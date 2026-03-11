class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.code = 'NOT_FOUND';
  }
}

module.exports = { NotFoundError };
