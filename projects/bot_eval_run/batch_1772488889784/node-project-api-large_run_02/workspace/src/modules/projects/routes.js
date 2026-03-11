// src/modules/projects/routes.js
const express = require('express');
const router = express.Router();
const projectsService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (req, res) => {
  try {
    const projects = await projectsService.getProjects();
    res.json({ projects });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_INPUT', 'Invalid input data');
  }
  try {
    const project = await projectsService.createProject(name);
    res.status(201).json({ project });
  } catch (error) {
    if (error.code === 'DUPLICATE') {
      return sendError(res, 409, 'DUPLICATE', error.message);
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.get('/:projectId', async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await projectsService.getProjectById(projectId);
    if (!project) {
      return sendError(res, 404, 'NOT_FOUND', 'Project not found');
    }
    res.json({ project });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
