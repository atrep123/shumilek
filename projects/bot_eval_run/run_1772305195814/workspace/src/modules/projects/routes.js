const express = require('express');
const router = express.Router();
const projectService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', (req, res) => {
  const projects = projectService.getAllProjects();
  res.json({ projects });
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_NAME', 'Name is required');
  }
  const project = projectService.createProject(name);
  res.status(201).json({ project });
});

module.exports = router;
