const express = require('express');
const { sendError } = require('../../lib/errors');
const tasksService = require('./service');

const router = express.Router();

router.post('/', (req, res) => {
  const { projectId } = req.params;
  const task = tasksService.createTask(projectId);
  if (!task) {
    return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  res.status(201).json({ task });
});

router.get('/', (req, res) => {
  const { projectId } = req.params;
  const tasks = tasksService.getTasksByProjectId(projectId);
  if (!tasks) {
    return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  res.json({ tasks });
});

router.patch('/:taskId', (req, res) => {
  const { projectId, taskId } = req.params;
  const { status } = req.body;
  if (!status || !['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Status must be todo or done');
  }
  const task = tasksService.updateTaskStatus(projectId, taskId, status);
  if (!task) {
    return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  }
  res.json({ task });
});

module.exports = router;
