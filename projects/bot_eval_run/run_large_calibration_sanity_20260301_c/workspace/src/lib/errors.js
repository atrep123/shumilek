const sendError = (res, status, code, message) => {
  res.status(status).json({ error: { code, message } });
};
exports.sendError = sendError;
