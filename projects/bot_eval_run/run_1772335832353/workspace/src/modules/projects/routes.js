const express = require('express');
const projectsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_INPUT', 'Name is required');
  }

  const project = await projectsService.createProject(name);
  res.status(201).json({ project });
});

router.get('/', async (req, res) => {
  const projects = await projectsService.getAllProjects();
  res.json({ projects });
});

module.exports = router;
