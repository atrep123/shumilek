const express = require('express');
const router = express.Router();
const projectsService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', (req, res) => {
  const projects = projectsService.getAllProjects();
  res.json({ projects });
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_NAME', 'Name is required');
  }
  const project = projectsService.createProject(name);
  res.status(201).json({ project });
});

module.exports = router;
