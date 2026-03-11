const express = require('express');
const { sendError } = require('../../lib/errors');
const projectService = require('./service');

const router = express.Router();

router.post('/', (req, res) => {
  const name = req.body.name;
  if (!name) return sendError(res, 400, 'INVALID_NAME', 'Name is required');

  const project = projectService.addProject(name);
  res.status(201).json({ project });
});

router.get('/', (req, res) => {
  const projects = projectService.getAllProjects();
  res.json({ projects });
});

module.exports = router;
