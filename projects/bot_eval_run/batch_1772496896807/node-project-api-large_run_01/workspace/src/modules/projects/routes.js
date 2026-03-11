// src/modules/projects/routes.js
const express = require('express');
const projectsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const projects = await projectsService.getAllProjects();
    res.json({ projects });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return sendError(res, 400, 'INVALID_NAME', 'Name must be a non-empty string');
  }

  try {
    const __existingProject = await projectsService.getProjectByName(name);
  if (__existingProject) return sendError(res, 409, 'PROJECT_DUPLICATE', 'Project already exists');
  const project = await projectsService.createProject(name);
  if (!project) return sendError(res, 409, 'PROJECT_DUPLICATE', 'Project already exists');
    res.status(201).json({ project });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.get('/:projectId', async (req, res) => {
  const { projectId } = req.params;

  try {
    const project = await projectsService.getProjectById(projectId);
    if (!project) {
      return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    }
    res.json({ project });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
