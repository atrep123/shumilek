// src/modules/projects/routes.js
const express = require('express');
const projectsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.get('/:projectId', async (req, res) => {
  const projectId = req.params.projectId;
  try {
    const project = await projectsService.getProjectById(projectId);
    if (!project) {
      return sendError(res, 404, 'NOT_FOUND', 'Project not found');
    }
    res.json({ project });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return sendError(res, 400, 'INVALID_INPUT', 'Name is required and must be a non-empty string');
  }
  try {
    const project = await projectsService.createProject(name);
    res.status(201).json({ project });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

module.exports = router;
