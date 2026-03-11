const router = require('express').Router();
const projectsService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (_req, res) => {
  const projects = await projectsService.getProjects();
  res.json({ projects });
});

router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return sendError(res, 400, 'BAD_REQUEST', 'Project name is required');
  const duplicate = await projectsService.getProjectByName(name);
  if (duplicate) return sendError(res, 409, 'PROJECT_DUPLICATE', 'Project already exists');
  const project = projectsService.createProject(name);
  res.status(201).json({ project });
});

router.get('/:projectId', async (req, res) => {
  const project = await projectsService.getProjectById(req.params.projectId);
  if (!project) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  res.json({ project });
});

module.exports = router;
