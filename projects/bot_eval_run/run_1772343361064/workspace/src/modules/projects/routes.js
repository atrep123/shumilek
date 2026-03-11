const express = require('express');
const projectsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'BAD_REQUEST', 'Name is required');
  }

  const project = projectsService.createProject(name);
  if (!project) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create project');
  }

  res.status(201).json({ project });
});

router.get('/', (req, res) => {
  const projects = projectsService.getAllProjects();
  if (!projects) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch projects');
  }

  res.json({ projects });
});

router.get('/:projectId', (req, res) => {
  const project = projectsService.getProjectById(req.params.projectId);
  if (!project) {
    return sendError(res, 404, 'NOT_FOUND', 'Project not found');
  }

  res.json({ project });
});

module.exports = router;
