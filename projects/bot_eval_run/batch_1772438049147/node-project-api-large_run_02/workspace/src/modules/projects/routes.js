// src/modules/projects/routes.js
const express = require('express');
const projectsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

// Get all projects
router.get('/', async (req, res) => {
  try {
    const projects = await projectsService.getAllProjects();
    res.json({ projects });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

// Get project by ID
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

// Create a new project
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return sendError(res, 400, 'INVALID_NAME', 'Invalid project name');
  }
  try {
    const newProject = await projectsService.createProject(name);
    res.status(201).json({ project: newProject });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
