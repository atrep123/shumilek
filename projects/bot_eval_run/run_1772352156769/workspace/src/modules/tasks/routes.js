const express = require('express');
const tasksService = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router({ mergeParams: true });

router.post('/', (req, res) => {
  const task = tasksService.createTask(req.params.projectId);
  if (!task) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create task');
  }

  res.status(201).json({ task });
});

router.get('/', (req, res) => {
  const tasks = tasksService.getTasks(req.params.projectId);
  if (!tasks) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to fetch tasks');
  }

  res.json({ tasks });
});

router.patch('/:taskId', (req, res) => {
  const { status } = req.body;
  if (!status || !['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Status must be either todo or done');
  }

  const task = tasksService.updateTask(req.params.projectId, req.params.taskId, status);
  if (!task) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update task');
  }

  res.json({ task });
});

module.exports = router;
