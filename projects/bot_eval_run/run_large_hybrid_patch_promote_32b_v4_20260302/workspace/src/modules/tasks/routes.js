const express = require('express');
const router = express.Router();
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

router.post('/', (req, res) => {
  const task = req.body;
  if (!task.name) {
    return sendError(res, 400, 'INVALID_PAYLOAD', 'Task name is required');
  }

  const result = tasksService.addTask(req.projectId, { ...task, status: 'todo' });
  res.status(201).json({ task: result });
});

router.get('/', (req, res) => {
  const { status } = req.query;
  const tasks = tasksService.getTasks(req.projectId);
  if (status) {
    return res.json({ tasks: tasks.filter(t => t.status === status) });
  }
  res.json({ tasks });
});

router.patch('/:taskId', (req, res) => {
  const { taskId } = req.params;
  const { status } = req.body;
  if (!['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Status must be either todo or done');
  }

  const result = tasksService.updateTask(taskId, { status });
  if (result === null) {
    return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  }

  res.json({ task: result });
});

module.exports = router;
