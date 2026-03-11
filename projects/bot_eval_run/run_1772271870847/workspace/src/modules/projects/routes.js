const express = require('express');
const { getProjects, createProject, getProjectById } = require('./service');

const router = express.Router();

router.get('/', (req, res) => {
  const projects = getProjects();
  res.json({ projects });
});

router.post('/', (req, res) => {
  const { name } = req.body;
  try {
    const project = createProject(name);
    res.status(201).json({ project });
  } catch (error) {
    res.status(error.code === 'duplicate' ? 409 : 400).json({ error: { code: error.code, message: error.message } });
  }
});

router.get('/:projectId', (req, res) => {
  const project = getProjectById(req.params.projectId);
  if (!project) {
    return res.status(404).json({ error: { code: 'not_found', message: 'Project not found' } });
  }
  res.json({ project });
});

module.exports = router;
