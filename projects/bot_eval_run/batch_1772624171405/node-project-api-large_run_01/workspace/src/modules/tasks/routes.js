const router = require('express').Router({ mergeParams: true });
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (req, res) => {
  const status = String(req.query?.status || '').trim();
  const tasks = await tasksService.getTasks(req.params.projectId, status);
  if (!tasks) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');

  res.json({ tasks });
});

router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return sendError(res, 400, 'BAD_REQUEST', 'Name is required');

  const task = await tasksService.addTask(req.params.projectId, name);
  if (!task) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');

  res.status(201).json({ task });
});

router.patch('/:taskId', async (req, res) => {
  const status = String(req.body?.status || '').trim();
  if (!['todo', 'done'].includes(status)) return sendError(res, 400, 'BAD_REQUEST', 'Invalid status');

  const task = await tasksService.updateTaskStatus(req.params.projectId, req.params.taskId, status);
  if (!task) return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');

  res.json({ task });
});

module.exports = router;
