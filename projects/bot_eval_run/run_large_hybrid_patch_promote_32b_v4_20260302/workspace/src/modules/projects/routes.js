const express = require('express');
const router = express.Router();
const projectsService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/:projectId', (req, res) => {
  const project = projectsService.getProject(req.params.projectId);
  if (!project) {
    return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  res.json({ project });
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'Project name is required');
  }

  const result = projectsService.addProject({ name });
  res.status(201).json({ project: result });
});

module.exports = router;
