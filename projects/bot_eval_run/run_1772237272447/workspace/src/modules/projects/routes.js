const express = require('express');
const router = express.Router();
const projectService = require('./service');

router.get('/', (req, res) => {
  const projects = projectService.getAllProjects();
  res.json({ projects });
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Name is required' } });
  }
  const project = projectService.createProject(name);
  res.status(201).json({ project });
});

router.get('/:id', (req, res) => {
  const { id } = req.params;
  const project = projectService.getProjectById(id);
  if (!project) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  }
  res.json({ project });
});

module.exports = router;
