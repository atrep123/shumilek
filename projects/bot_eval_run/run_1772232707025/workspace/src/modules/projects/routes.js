const express = require('express');
const service = require('./service');

const router = express.Router();

router.get('/', (req, res) => {
  const projects = service.getAllProjects();
  res.json({ projects });
});

router.post('/', (req, res) => {
  const project = service.createProject(req.body);
  res.status(201).json({ project });
});

router.get('/:id', (req, res) => {
  const project = service.getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  }
  res.json({ project });
});

module.exports = router;
