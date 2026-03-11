class BadRequestError extends Error {
  constructor(message) {
    super(message);
    this.code = 'E_BADREQUEST';
  }
}
exports.sendError = function(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
};