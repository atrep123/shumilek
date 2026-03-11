const express = require('express');
const { sendError } = require('../../lib/errors');
const projectsService = require('./service');

const router = express.Router();

router.get('/', (req, res) => {
  const projects = projectsService.getAllProjects();
  res.json({ projects });
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_INPUT', 'Name is required');
  }

  const project = projectsService.createProject(name);
  res.status(201).json({ project });
});

router.get('/:projectId', (req, res) => {
  const project = projectsService.getProjectById(req.params.projectId);
  if (!project) {
    return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  req.projectId = req.params.projectId;
  res.json({ project });
});

module.exports = router;
