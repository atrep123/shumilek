function errorHandler(res, error) {
  switch (error.code) {
    case 'not_found':
      res.status(404).json({ error: { code: error.code, message: error.message } });
      break;
    case 'duplicate':
      res.status(409).json({ error: { code: error.code, message: error.message } });
      break;
    default:
      res.status(400).json({ error: { code: 'invalid_input', message: error.message || 'Invalid input' } });
  }
}

module.exports = { errorHandler };
