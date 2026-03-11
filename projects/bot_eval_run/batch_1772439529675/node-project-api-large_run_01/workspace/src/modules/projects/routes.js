// src/modules/projects/routes.js
const express = require('express');
const router = express.Router();
const projectsService = require('../projects/service');
const { sendError } = require('../../lib/errors');

router.get('/', async (req, res) => {
  try {
    const projects = await projectsService.getAllProjects();
    res.json({ projects });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.get('/:projectId', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const project = await projectsService.getProjectById(projectId);
    if (!project) {
      return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    }
    res.json({ project });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return sendError(res, 400, 'INVALID_NAME', 'Invalid project name');
    }
    const newProject = await projectsService.createProject(name);
    res.status(201).json({ project: newProject });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
