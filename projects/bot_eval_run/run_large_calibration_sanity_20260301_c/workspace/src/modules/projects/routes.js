const express = require('express');
const router = express.Router({ mergeParams: true });
const service = require('./service');

// Create a new project
router.post('/', async (req, res) => {
  if (!req.body.name) return sendError(res, 400, 'MissingName', 'Project name is required');
  const project = await service.createProject({ id: crypto.randomUUID(), ...req.body });
  res.status(201).json({ project });
});

module.exports = router;
