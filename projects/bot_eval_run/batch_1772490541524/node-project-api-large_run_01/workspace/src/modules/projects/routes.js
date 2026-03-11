const express = require('express');
const projectsService = require('./service');
const sendError = require('../../lib/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const projects = await projectsService.getAllProjects();
    res.json({ projects });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_INPUT', 'Name is required');
  }
  try {
    const __existingProject = await projectsService.getProjectByName(name);
  if (__existingProject) return sendError(res, 409, 'PROJECT_DUPLICATE', 'Project already exists');
  const project = await projectsService.createProject(name);
    res.status(201).json({ project });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message);
  }
});

router.get('/:projectId', async (req, res) => {
  try {
    const project = await projectsService.getProjectById(req.params.projectId);
    if (!project) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return res.json({ project });
  } catch (_error) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});


module.exports = router;
