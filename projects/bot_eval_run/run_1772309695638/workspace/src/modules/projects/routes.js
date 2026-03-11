const express = require('express');
const { sendError } = require('../../lib/errors');
const projectsService = require('./service');

const router = express.Router();

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_INPUT', 'Project name is required');
  }

  const project = projectsService.addProject({ name });
  res.status(201).json({ project });
});

router.get('/', (req, res) => {
  const projects = projectsService.getProjects();
  res.json({ projects });
});

module.exports = router;
