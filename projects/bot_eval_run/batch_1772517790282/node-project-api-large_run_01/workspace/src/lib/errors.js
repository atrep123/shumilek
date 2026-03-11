function sendError(res, statusCode, errorCode, message) {
  return res.status(statusCode).json({ error: { code: errorCode, message } });
}

module.exports = {
  sendError,
};
