const express = require('express');
const tasksService = require('./service');
const sendError = require('../../lib/errors').sendError;

const router = express.Router();

router.post('/', (req, res) => {
  const { projectId } = req.params;
  const task = tasksService.createTask(projectId);
  if (!task) {
    return sendError(res, 404, 'NOT_FOUND', 'Project not found');
  }
  res.status(201).json({ task });
});

router.patch('/:taskId', (req, res) => {
  const { projectId, taskId } = req.params;
  const { status } = req.body;
  if (!status || !['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_INPUT', 'Status must be todo or done');
  }
  const task = tasksService.updateTaskStatus(projectId, taskId, status);
  if (!task) {
    return sendError(res, 404, 'NOT_FOUND', 'Task not found');
  }
  res.json({ task });
});

router.get('/', (req, res) => {
  const { projectId } = req.params;
  const { status } = req.query;
  const tasks = tasksService.getTasksByStatus(projectId, status);
  if (!tasks) {
    return sendError(res, 404, 'NOT_FOUND', 'Project not found');
  }
  res.json({ tasks });
});

module.exports = router;
