class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.statusCode = code === 'not_found' ? 404 : 400;
  }
}

module.exports = { AppError };
