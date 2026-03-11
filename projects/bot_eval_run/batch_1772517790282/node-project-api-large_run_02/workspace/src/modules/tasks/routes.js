const express = require('express');
const service = require('./service');
const { sendError } = require('../../lib/errors');

const router = express.Router();

router.post('/', (req, res) => {
  const task = service.createTask(req.projectId);
  res.status(201).json({ task });
});

router.get('/', (req, res) => {
  const { status } = req.query;
  let tasks = service.getTasksByProjectId(req.projectId);
  if (status) {
    tasks = tasks.filter(task => task.status === status);
  }
  res.json({ tasks });
});

router.patch('/:taskId', (req, res) => {
  const { taskId } = req.params;
  const { status } = req.body;
  if (!['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Status must be todo or done');
  }
  const task = service.updateTaskStatus(taskId, status);
  if (!task) {
    return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  }
  res.json({ task });
});

module.exports = router;
