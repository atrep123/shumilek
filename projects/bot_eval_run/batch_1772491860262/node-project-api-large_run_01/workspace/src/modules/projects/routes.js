// src/modules/projects/routes.js
const express = require('express');
const projectsService = require('./service');

const router = express.Router();

// Create a new project
router.post('/', async (req, res) => {
  try {
    const project = await projectsService.createProject(req.body);
    if (!project) {
      return res.status(409).json({ error: { code: 'PROJECT_EXISTS', message: 'Project already exists' } });
    }
    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  }
});

// List all projects
router.get('/', async (req, res) => {
  try {
    const projects = await projectsService.getAllProjects();
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  }
});

// Get a specific project by ID
router.get('/:projectId', async (req, res) => {
  try {
    const project = await projectsService.getProjectById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } });
    }
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  }
});

module.exports = router;
