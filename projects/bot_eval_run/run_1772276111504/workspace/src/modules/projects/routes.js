const express = require('express');
const { getProjects, createProject, getProjectById } = require('./service');
const router = express.Router();

router.get('/', (req, res) => {
  try {
    const projects = getProjects();
    res.json({ projects });
  } catch (error) {
    res.status(error.code).json({ error: { code: error.code, message: error.message } });
  }
});

router.post('/', (req, res) => {
  try {
    const project = createProject(req.body);
    res.status(201).json({ project });
  } catch (error) {
    res.status(error.code).json({ error: { code: error.code, message: error.message } });
  }
});

router.get('/:projectId', (req, res) => {
  try {
    const project = getProjectById(req.params.projectId);
    res.json({ project });
  } catch (error) {
    res.status(error.code).json({ error: { code: error.code, message: error.message } });
  }
});

module.exports = router;
