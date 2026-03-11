const router = require('express').Router();
const projectsService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (req, res) => {
  const projects = await projectsService.getAllProjects();
  res.json({ projects });
});

router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return sendError(res, 400, 'BAD_REQUEST', 'Name is required');

  const project = await projectsService.createProject(name);
  if (!project) return sendError(res, 409, 'PROJECT_DUPLICATE', 'Project already exists');
  if (project.duplicate) return sendError(res, 409, 'PROJECT_DUPLICATE', 'Project already exists');

  res.status(201).json({ project: project.project });
});

router.get('/:projectId', async (req, res) => {
  const project = await projectsService.getProjectById(req.params.projectId);
  if (!project) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');

  res.json({ project });
});

module.exports = router;
