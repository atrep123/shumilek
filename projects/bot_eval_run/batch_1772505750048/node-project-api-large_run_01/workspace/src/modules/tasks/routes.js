const express = require('express');
tasksService = require('./service');
sendError = require('../../lib/errors').sendError;

const router = express.Router();

// Create a new task for a project
router.post('/', (req, res) => {
  const { projectId } = req.params;
  const task = tasksService.createTask(projectId);
  if (!task) {
    return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  res.status(201).json({ task });
});

// Get all tasks for a project with optional status filter
router.get('/', (req, res) => {
  const { projectId } = req.params;
  const { status } = req.query;
  const tasks = tasksService.getTasksByProjectId(projectId);
  if (!tasks) {
    return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  const filteredTasks = status ? tasks.filter(task => task.status === status) : tasks;
  res.json({ tasks: filteredTasks });
});

// Update a task's status
router.patch('/:taskId', (req, res) => {
  const { projectId, taskId } = req.params;
  const { status } = req.body;
  if (!status || !['todo', 'done'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'Status must be either todo or done');
  }
  const task = tasksService.updateTaskStatus(projectId, taskId, status);
  if (!task) {
    return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');
  }
  res.json({ task });
});

module.exports = router;
