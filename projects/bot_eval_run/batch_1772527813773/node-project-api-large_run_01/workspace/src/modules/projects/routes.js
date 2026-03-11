const express = require('express');
const projectsService = require('./service');
const { randomUUID } = require('../../lib/id');

const router = express.Router();

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Name is required' } });
  }
  const project = projectsService.createProject(name);
  if (!project) {
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'Project already exists' } });
  }
  res.status(201).json({ project });
});

router.get('/', (req, res) => {
  const projects = projectsService.getAllProjects();
  res.json({ projects });
});

router.get('/:projectId', (req, res) => {
  const { projectId } = req.params;
  const project = projectsService.getProjectById(projectId);
  if (!project) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  }
  res.json({ project });
});

module.exports = router;
