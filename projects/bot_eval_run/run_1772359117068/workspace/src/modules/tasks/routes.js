const express = require('express');
const router = express.Router();
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

router.get('/', (req, res) => {
  const status = req.query.status;
  const tasks = tasksService.getTasks(req.projectId, status);
  res.json({ tasks });
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return sendError(res, 400, 'INVALID_NAME', 'Name is required');
  }
  const task = tasksService.createTask(req.projectId, name);
  res.status(201).json({ task });
});

router.patch('/:taskId', (req, res) => {
  const { status } = req.body;
  if (!status || !['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Status must be todo or done');
  }
  const task = tasksService.updateTask(req.projectId, req.params.taskId, status);
  if (!task) {
    return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  }
  res.json({ task });
});

module.exports = router;
