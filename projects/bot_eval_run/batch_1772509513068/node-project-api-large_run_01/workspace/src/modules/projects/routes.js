// src/modules/projects/routes.js
const router = require('express').Router();
const projectsService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (_req, res) => {
  try {
    const projects = await projectsService.getAllProjects();
    return res.json({ projects });
  } catch (error) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return sendError(res, 400, 'BAD_REQUEST', 'Project name is required');
  try {
    const duplicate = await projectsService.getProjectByName(name);
    if (duplicate) return sendError(res, 409, 'PROJECT_DUPLICATE', 'Project already exists');
    const project = await projectsService.createProject(name);
  if (!project) return sendError(res, 409, 'PROJECT_DUPLICATE', 'Project already exists');
    if (!project) return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create project');
    return res.status(201).json({ project });
  } catch (error) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.get('/:projectId', async (req, res) => {
  try {
    const project = await projectsService.getProjectById(req.params.projectId);
    if (!project) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
    return res.json({ project });
  } catch (error) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

module.exports = router;
