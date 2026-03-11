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
    return sendError(res, 400, 'BAD_REQUEST', 'Name is required');
  }
  const project = service.createProject(name);
  res.status(201).json({ project });
});

router.get('/:projectId', (req, res) => {
  const { projectId } = req.params;
  const project = service.getProjectById(projectId);
  if (!project) {
    return sendError(res, 404, 'NOT_FOUND', 'Project not found');
  }
  res.json({ project });
});

module.exports = router;
