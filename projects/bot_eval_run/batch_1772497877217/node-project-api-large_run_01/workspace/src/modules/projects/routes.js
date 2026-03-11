// src/modules/projects/routes.js
const express = require('express');
const projectsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.get('/:projectId', async (req, res) => {
  const projectId = req.params.projectId;
  const project = await projectsService.getProjectById(projectId);
  if (!project) {
    return sendError(res, 404, 'NOT_FOUND', 'Project not found');
  }
  res.json({ project });
});

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_INPUT', 'Name is required');
  }
  const __existingProject = await projectsService.getProjectByName(name);
  if (__existingProject) return sendError(res, 409, 'PROJECT_DUPLICATE', 'Project already exists');
  const project = await projectsService.createProject(name);
  if (!project) return sendError(res, 409, 'PROJECT_DUPLICATE', 'Project already exists');
  res.status(201).json({ project });
});

module.exports = router;
