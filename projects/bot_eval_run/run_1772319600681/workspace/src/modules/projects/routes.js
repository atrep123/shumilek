const express = require('express');
const projectService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_NAME', 'Name is required');
  }
  const project = projectService.createProject(name);
  res.status(201).json({ project });
});

router.get('/', (req, res) => {
  const projects = projectService.getAllProjects();
  res.json({ projects });
});

module.exports = router;
