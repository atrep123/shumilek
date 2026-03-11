const router = require('express').Router({ mergeParams: true });
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', async (_req, res) => res.json({ tasks: await tasksService.getAllTasks() }));
router.post('/', async (req, res) => {
  const description = String(req.body?.description || '').trim();
  if (!title) return sendError(res, 400, 'BAD_REQUEST', 'Task Title is required');
  const task = await tasksService.createTask(description);
  if (!task) return sendError(res, 409, 'TASK_DUPLICATE', 'Task already exists');
  return res.status(201).json({ task });
});

router.patch('/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  const status = String(req.body?.status || '').trim();
  if (!status) return sendError(res, 400, 'BAD_REQUEST', 'Task status is required');
  const updatedTask = await tasksService.updateTask(taskId, status);
  if (!updatedTask) return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  return res.json({ task: updatedTask });
});

module.exports = router;
