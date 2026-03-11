const express = require('express');
const projectService = require('./service');
const router = express.Router();

router.get('/', (req, res) => {
  const projects = projectService.getAllProjects();
  res.json({ projects });
});

router.post('/', (req, res, next) => {
  try {
    const project = projectService.createProject(req.body.name);
    res.status(201).json({ project });
  } catch (err) {
    next(err);
  }
});

router.get('/:projectId', (req, res, next) => {
  try {
    const project = projectService.getProjectById(req.params.projectId);
    res.json({ project });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
