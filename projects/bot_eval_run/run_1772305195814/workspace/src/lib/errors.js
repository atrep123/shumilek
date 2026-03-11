function sendError(res, statusCode, errorCode, message) {
  res.status(statusCode).json({ error: { code: errorCode, message } });
}

module.exports = {
  sendError
};
