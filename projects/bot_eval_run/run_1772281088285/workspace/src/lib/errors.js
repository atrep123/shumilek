function handleError(res, error) {
  const { code, message } = error;
  res.status(400).json({ error: { code, message } });
}

module.exports = { handleError };
