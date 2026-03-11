export function sendError(res, status, code, message) {
  res.status(status).send({ error: { code, message } });
}
