const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.get('/', (req, res) => {
  const projects = service.getAllProjects();
  res.json({ projects });
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_INPUT', 'Project name is required.');
  }

  const result = service.addProject({ name });
  if (result.error) {
    return sendError(res, result.status, result.error.code, result.error.message);
  }

  res.status(201).json({ project: result.project });
});

router.get('/:projectId', (req, res) => {
  const projectId = req.params.projectId;
  const project = service.getProjectById(projectId);
  if (!project) {
    return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  }

  res.json({ project });
});

module.exports = router;
