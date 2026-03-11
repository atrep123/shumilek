const express = require('express');
const { sendError } = require('../../lib/errors');
const projectService = require('./service');

const router = express.Router();

router.get('/', (req, res) => {
  const projects = projectService.getAllProjects();
  res.json({ projects });
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return sendError(res, 400, 'INVALID_NAME', 'Name must be a non-empty string');
  }

  const project = projectService.createProject(name);
  res.status(201).json({ project });
});

module.exports = router;
