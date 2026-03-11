const express = require('express');
const router = express.Router();
const projectService = require('./service');

router.get('/', (req, res) => {
  const projects = projectService.getAllProjects();
  res.status(200).json({ projects });
});

router.post('/', (req, res) => {
  try {
    const project = projectService.createProject(req.body.name);
    res.status(201).json({ project });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: { code: error.code, message: error.message } });
  }
});

router.get('/:projectId', (req, res) => {
  try {
    const project = projectService.getProjectById(req.params.projectId);
    res.status(200).json({ project });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: { code: error.code, message: error.message } });
  }
});

module.exports = (app) => app.use('/projects', router);
