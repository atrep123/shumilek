const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'BAD_REQUEST', 'Project name is required');
  }

  const project = service.createProject(name);
  if (!project) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create project');
  }

  res.status(201).json({ project });
});

router.get('/:projectId', (req, res) => {
  const project = service.getProjectById(req.params.projectId);
  if (!project) {
    return sendError(res, 404, 'NOT_FOUND', 'Project not found');
  }

  req.projectId = req.params.projectId;
  res.json({ project });
});

router.get('/', (req, res) => {
  const projects = service.getAllProjects();
  if (!projects) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to get projects');
  }

  res.json({ projects });
});

module.exports = router;
