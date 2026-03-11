// src/modules/projects/routes.js
const express = require('express');
const projectsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.get('/', (req, res) => {
  const projects = projectsService.getAllProjects();
  res.json({ projects });
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'BAD_REQUEST', 'Name is required');
  }
  const project = projectsService.createProject(name);
  if (!project) {
    return sendError(res, 409, 'DUPLICATE_PROJECT', 'Project already exists');
  }
  res.status(201).json({ project });
});

router.get('/:projectId', (req, res) => {
  const { projectId } = req.params;
  const project = projectsService.getProjectById(projectId);
  if (!project) {
    return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  res.json({ project });
});

module.exports = router;
