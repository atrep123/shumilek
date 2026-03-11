// src/modules/tasks/routes.js
const router = require('express').Router();
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (req, res) => {
  const status = typeof req.query?.status === 'string' ? req.query.status : undefined;
  const tasks = await tasksService.getTasksByProjectId(req.params.projectId, status);
  if (!tasks) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  return res.json({ tasks });
});

router.post('/', async (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (!title) return sendError(res, 400, 'BAD_REQUEST', 'Task title is required');
  const task = await tasksService.createTask(req.params.projectId, title);
  if (!task) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  return res.status(201).json({ task });
});

router.patch('/:taskId', async (req, res) => {
  const status = String(req.body?.status || '').trim();
  if (status !== 'todo' && status !== 'done') return sendError(res, 400, 'INVALID_STATUS', 'Status must be todo or done');
  const task = await tasksService.updateTaskStatus(req.params.projectId, req.params.taskId, status);
  if (!task) return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  return res.json({ task });
});

module.exports = router;
