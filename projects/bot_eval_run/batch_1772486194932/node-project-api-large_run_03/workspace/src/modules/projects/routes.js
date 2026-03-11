const express = require('express');
const projectsService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.get('/:projectId', async (req, res) => {
  try {
    const project = await projectsService.getProject(req.params.projectId);
    if (!project) {
      return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    }
    res.json({ project });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to get project');
  }
});

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'Name is required');
  }
  try {
    const project = await projectsService.createProject(name);
    res.status(201).json({ project });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create project');
  }
});

module.exports = router;
