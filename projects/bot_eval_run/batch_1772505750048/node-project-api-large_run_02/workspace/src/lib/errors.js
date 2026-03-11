function errorHandler(res, error) {
  switch (error.code) {
    case 'invalid_input':
      res.status(400).json({ error: error.message });
      break;
    case 'not_found':
      res.status(404).json({ error: error.message });
      break;
    case 'duplicate_project':
    case 'duplicate_member':
      res.status(409).json({ error: error.message });
      break;
    default:
      res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { errorHandler };
