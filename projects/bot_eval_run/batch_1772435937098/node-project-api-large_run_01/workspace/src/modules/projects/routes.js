const express = require('express');
const projectsService = require('./service');
const sendError = require('../../lib/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const projects = await projectsService.getAllProjects();
    res.json({ projects });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_INPUT', 'Name is required');
  }
  try {
    const project = await projectsService.createProject(name);
    res.status(201).json({ project });
  } catch (error) {
    if (error.code === 'PROJECT_EXISTS') {
      sendError(res, 409, 'PROJECT_EXISTS', 'Project already exists');
    } else {
      sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  }
});

module.exports = router;
